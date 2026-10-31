import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClientIp, handleCors, verifyAdminRequest, getAuthSecret } from './_utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFallback() {
  try {
    const p1 = path.resolve(__dirname, '../.env');
    const p2 = path.join(process.cwd(), '.env');
    const envPath = fs.existsSync(p1) ? p1 : (fs.existsSync(p2) ? p2 : null);
    if (envPath) {
      const raw = fs.readFileSync(envPath, 'utf8');
      const lines = raw.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx > 0) {
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
  } catch (_) {}
}
loadEnvFallback();

const customHttpsAgent = new https.Agent({
  rejectUnauthorized: true,
  keepAlive: true,
});

function getEnvConfig() {
  const r2Endpoint = String(process.env.R2_ENDPOINT || '').replace(/\/+$/, '');
  const r2Bucket = String(process.env.R2_BUCKET || 'linkadda-shop').trim();
  const r2AccessKey = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const r2SecretKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const r2PublicUrl = String(process.env.R2_PUBLIC_URL || 'https://pub-81f10c1135f54a719e5d96e8d7896960.r2.dev').replace(/\/+$/, '');

  if (r2Endpoint && r2AccessKey && r2SecretKey) {
    return {
      type: 's3',
      endpoint: r2Endpoint,
      bucket: r2Bucket,
      region: 'auto',
      accessKeyId: r2AccessKey,
      secretAccessKey: r2SecretKey,
      publicUrl: r2PublicUrl,
    };
  }

  const endpoint = String(process.env.FILEBASE_ENDPOINT || process.env.S3_ENDPOINT || process.env.RUSTFS_ENDPOINT || '').replace(/\/+$/, '');
  const bucket = String(process.env.FILEBASE_BUCKET || process.env.S3_BUCKET || process.env.RUSTFS_BUCKET || 'linkadda-shop').trim();
  const region = String(process.env.FILEBASE_REGION || process.env.S3_REGION || process.env.RUSTFS_REGION || 'us-east-1').trim();
  const accessKeyId = String(process.env.FILEBASE_ACCESS_KEY || process.env.S3_ACCESS_KEY || process.env.RUSTFS_ACCESS_KEY || '').trim();
  const secretAccessKey = String(process.env.FILEBASE_SECRET_KEY || process.env.S3_SECRET_KEY || process.env.RUSTFS_SECRET_KEY || '').trim();

  if (endpoint && accessKeyId && secretAccessKey) {
    return { type: 's3', endpoint, bucket, region, accessKeyId, secretAccessKey, publicUrl: '' };
  }

  const supabaseUrl = process.env.SUPABASE_URL || 'https://mkttxqwpbostzmfygpzq.supabase.co';
  return {
    type: 'supabase',
    url: supabaseUrl,
    bucket: process.env.SUPABASE_BUCKET || 'linkadda-media',
  };
}

async function uploadToStorageBackend(key, buffer, contentType, s3Client, config) {
  // 1. Primary: Cloudflare R2 / S3
  if (config.type === 's3' && s3Client) {
    await s3Client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    return {
      key,
      bucket: config.bucket,
      publicUrl: getPublicUrl(config, key),
    };
  }

  // 2. Fallback: Supabase Storage
  const supabaseUrl = (process.env.SUPABASE_URL || 'https://mkttxqwpbostzmfygpzq.supabase.co').replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const supabaseBucket = process.env.SUPABASE_BUCKET || 'linkadda-media';

  if (supabaseUrl && serviceKey) {
    const cleanKey = String(key || '').replace(/^\/+/, '');
    const endpoint = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseBucket)}/${encodeURI(cleanKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'x-upsert': 'true',
        'Content-Type': contentType || 'application/octet-stream',
      },
      body: buffer,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase upload failed (${res.status}): ${errText}`);
    }
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(supabaseBucket)}/${encodeURI(cleanKey)}`;
    return {
      key: cleanKey,
      bucket: supabaseBucket,
      publicUrl,
    };
  }

  throw new Error('No storage backend configured.');
}

function getPublicUrl(config, key) {
  const cleanKey = String(key || '').replace(/^\/+/, '');
  if (config.publicUrl) {
    return `${config.publicUrl.replace(/\/+$/, '')}/${encodeURI(cleanKey)}`;
  }
  if (config.endpoint && config.endpoint.includes('filebase.com')) {
    return `https://${encodeURIComponent(config.bucket)}.s3.filebase.com/${encodeURI(cleanKey)}`;
  }
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodeURI(cleanKey)}`;
}

const uploadRateLimitMap = new Map();
const MAX_UPLOADS_PER_MIN = 25;

const ALLOWED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif',
  'mp4', 'webm', 'mov', 'm4v', 'ogg'
]);

function isAllowedExtension(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

function isValidMediaBuffer(buf, filename, mime) {
  if (!buf || buf.length < 4) return false;
  const ext = String(filename || '').split('.').pop().toLowerCase();
  const lowerMime = String(mime || '').toLowerCase();
  // Allow video formats
  if (['mp4', 'webm', 'mov', 'm4v', 'ogg'].includes(ext) || lowerMime.startsWith('video/')) {
    return true;
  }
  // Allow SVGs and GIFs
  if (ext === 'svg' || lowerMime.includes('svg') || ext === 'gif' || lowerMime.includes('gif')) {
    return true;
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // WEBP: 'RIFF' ... 'WEBP'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true;
  // AVIF
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') return true;
  return false;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function parseBase64(rawBase64, fallbackMime = 'image/png') {
  let cleanBase64 = String(rawBase64 || '');
  let mime = fallbackMime;
  if (cleanBase64.includes('base64,')) {
    const parts = cleanBase64.split('base64,');
    cleanBase64 = parts[1];
    const matchMime = parts[0].match(/data:([^;]+);/);
    if (matchMime) mime = matchMime[1];
  }
  return {
    buffer: Buffer.from(cleanBase64, 'base64'),
    mime,
  };
}

export default async function handler(req, res) {
  // CORS Headers
  if (handleCors(req, res, 'POST, OPTIONS')) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body || {};
    const rawFolder = String(body.folder || 'products').trim();
    const isCustomerOrderProof = /payment[-_\s]?screenshot|screenshots?|orders?/i.test(rawFolder);
    const folder = isCustomerOrderProof ? 'payment screenshot' : (rawFolder.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'products');

    // ━━ SECURITY CHECK: Caller must be verified Admin (except customer order screenshot proofs) ━━
    if (!isCustomerOrderProof) {
      const isAdmin = await verifyAdminRequest(req);
      if (!isAdmin) {
        return res.status(401).json({ error: 'Unauthorized: Admin authentication required to upload files.' });
      }
    }

    const clientIp = getClientIp(req);
    const now = Date.now();
    let timestamps = (uploadRateLimitMap.get(clientIp) || []).filter(ts => now - ts < 60000);
    if (timestamps.length >= MAX_UPLOADS_PER_MIN) {
      return res.status(429).json({ error: 'Too many upload requests. Please wait a minute.' });
    }
    timestamps.push(now);
    uploadRateLimitMap.set(clientIp, timestamps);

    const config = getEnvConfig();
    let s3 = null;
    if (config.type !== 'supabase' && config.endpoint) {
      s3 = new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        forcePathStyle: true,
        requestHandler: {
          httpsAgent: customHttpsAgent,
        },
      });
    }

    const action = String(body.action || '').toLowerCase();

    if (isCustomerOrderProof && (action === 'chunk' || action === 'assemble')) {
      return res.status(400).json({ error: 'Order proofs must use direct upload mode.' });
    }

    // ━━ 1. CHUNK UPLOAD MODE ━━
    if (action === 'chunk') {
      const uploadId = String(body.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const partIndex = Number(body.partIndex);
      if (!uploadId || isNaN(partIndex)) {
        return res.status(400).json({ error: 'Missing uploadId or partIndex for chunk upload.' });
      }

      const { buffer: chunkBuffer } = parseBase64(body.chunkBase64 || body.base64);
      if (!chunkBuffer || chunkBuffer.length === 0) {
        return res.status(400).json({ error: 'Empty chunk data provided.' });
      }

      const chunkKey = `_chunks/${uploadId}/${partIndex}`;
      if (config.type === 'supabase') {
        await uploadToStorageBackend(chunkKey, chunkBuffer, 'application/octet-stream', null, config);
      } else if (s3) {
        await s3.send(new PutObjectCommand({
          Bucket: config.bucket,
          Key: chunkKey,
          Body: chunkBuffer,
          ContentType: 'application/octet-stream',
        }));
      }

      return res.status(200).json({
        success: true,
        uploadId,
        partIndex,
        size: chunkBuffer.length,
      });
    }

    // ━━ 2. ASSEMBLE CHUNKS MODE ━━
    if (action === 'assemble') {
      const uploadId = String(body.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const totalParts = Number(body.totalParts);
      const folder = isCustomerOrderProof ? 'payment screenshot' : (String(body.folder || 'products').trim().replace(/[^a-zA-Z0-9_\-\s]/g, '') || 'products');
      const filename = String(body.filename || `${Date.now()}_asset.png`).replace(/[^a-zA-Z0-9_.-]/g, '_');
      const contentType = String(body.contentType || 'application/octet-stream');

      if (!uploadId || !totalParts || totalParts < 1) {
        return res.status(400).json({ error: 'Missing uploadId or totalParts for assembly.' });
      }

      const partBuffers = [];
      const supabaseUrl = process.env.SUPABASE_URL || 'https://mkttxqwpbostzmfygpzq.supabase.co';
      const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
      const supabaseBucket = process.env.SUPABASE_BUCKET || 'linkadda-media';

      for (let i = 0; i < totalParts; i++) {
        const chunkKey = `_chunks/${uploadId}/${i}`;
        if (config.type === 'supabase') {
          const chunkEndpoint = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(supabaseBucket)}/${encodeURI(chunkKey)}`;
          const chunkRes = await fetch(chunkEndpoint, {
            headers: {
              'apikey': serviceKey,
              'Authorization': `Bearer ${serviceKey}`,
            },
          });
          if (!chunkRes.ok) {
            throw new Error(`Failed to read chunk ${i} from storage: ${chunkRes.statusText}`);
          }
          const arrayBuffer = await chunkRes.arrayBuffer();
          partBuffers.push(Buffer.from(arrayBuffer));
        } else if (s3) {
          const chunkRes = await s3.send(new GetObjectCommand({
            Bucket: config.bucket,
            Key: chunkKey,
          }));
          const buf = await streamToBuffer(chunkRes.Body);
          partBuffers.push(buf);
        }
      }

      const combinedBuffer = Buffer.concat(partBuffers);

      if (!isAllowedExtension(filename)) {
        return res.status(400).json({ error: 'Invalid file extension. Allowed formats: images and videos.' });
      }
      if (!isValidMediaBuffer(combinedBuffer, filename, contentType)) {
        return res.status(400).json({ error: 'Uploaded file content is not a valid media format.' });
      }

      const key = `${folder}/${filename}`;
      const uploadRes = await uploadToStorageBackend(key, combinedBuffer, contentType, s3, config);

      return res.status(200).json({
        success: true,
        key: uploadRes.key,
        bucket: uploadRes.bucket,
        publicUrl: uploadRes.publicUrl,
        size: combinedBuffer.length,
        contentType,
      });
    }

    // ━━ 3. DIRECT UPLOAD MODE (Default for files < 3.5 MB) ━━
    let bodyBuffer;
    let contentType = 'image/png';
    let filename = `asset_${Date.now()}.png`;

    if (typeof body === 'object' && body !== null) {
      filename = String(body.filename || `${Date.now()}_asset.png`).replace(/[^a-zA-Z0-9_.-]/g, '_');
      contentType = String(body.contentType || 'image/png');

      if (body.base64) {
        const parsed = parseBase64(body.base64, contentType);
        bodyBuffer = parsed.buffer;
        if (parsed.mime) contentType = parsed.mime;
      } else if (body.buffer) {
        bodyBuffer = Buffer.from(body.buffer);
      }
    }

    if (!bodyBuffer || bodyBuffer.length === 0) {
      return res.status(400).json({ error: 'No image or file data provided.' });
    }

    if (isCustomerOrderProof && bodyBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Screenshot file size exceeds 5MB limit.' });
    }

    if (!isAllowedExtension(filename)) {
      return res.status(400).json({ error: 'Invalid file extension. Allowed formats: images and videos.' });
    }

    if (!isValidMediaBuffer(bodyBuffer, filename, contentType)) {
      return res.status(400).json({ error: 'Uploaded file content is not a valid media format.' });
    }

    const key = `${folder}/${filename}`;

    const uploadRes = await uploadToStorageBackend(key, bodyBuffer, contentType, s3, config);

    return res.status(200).json({
      success: true,
      key: uploadRes.key,
      bucket: uploadRes.bucket,
      publicUrl: uploadRes.publicUrl,
      size: bodyBuffer.length,
      contentType,
    });
  } catch (err) {
    console.error('S3 upload error in /api/upload:', err);
    return res.status(500).json({
      error: err?.message || 'Failed to upload asset to storage.',
    });
  }
}
