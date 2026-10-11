import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import https from 'node:https';
import { getClientIp, handleCors, verifyAdminRequest, getAuthSecret } from './_utils.js';
import { verifySellerToken } from './seller/auth.js';

const customHttpsAgent = new https.Agent({
  rejectUnauthorized: true,
  keepAlive: true,
});

function getEnvConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://dsleaglxbedljdxrikdn.supabase.co';
  if (supabaseUrl) {
    return {
      type: 'supabase',
      url: supabaseUrl,
      bucket: process.env.SUPABASE_BUCKET || 'linkadda-media',
    };
  }
  const endpoint = String(process.env.FILEBASE_ENDPOINT || process.env.S3_ENDPOINT || process.env.RUSTFS_ENDPOINT || 'https://s3.filebase.com').replace(/\/+$/, '');
  const bucket = String(process.env.FILEBASE_BUCKET || process.env.S3_BUCKET || process.env.RUSTFS_BUCKET || 'linkadda-media').trim();
  const region = String(process.env.FILEBASE_REGION || process.env.S3_REGION || process.env.RUSTFS_REGION || 'us-east-1').trim();
  const accessKeyId = String(process.env.FILEBASE_ACCESS_KEY || process.env.S3_ACCESS_KEY || process.env.RUSTFS_ACCESS_KEY || '').trim();
  const secretAccessKey = String(process.env.FILEBASE_SECRET_KEY || process.env.S3_SECRET_KEY || process.env.RUSTFS_SECRET_KEY || '').trim();

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Storage credentials are not properly configured on server.');
  }

  return { endpoint, bucket, region, accessKeyId, secretAccessKey };
}

async function uploadToStorageBackend(key, buffer, contentType, s3Client, config) {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://dsleaglxbedljdxrikdn.supabase.co';
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const supabaseBucket = process.env.SUPABASE_BUCKET || 'linkadda-media';

  if (supabaseUrl && serviceKey) {
    const cleanKey = String(key || '').replace(/^\/+/, '');
    const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(supabaseBucket)}/${encodeURI(cleanKey)}`;
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
    const publicUrl = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${encodeURIComponent(supabaseBucket)}/${encodeURI(cleanKey)}`;
    return {
      key: cleanKey,
      bucket: supabaseBucket,
      publicUrl,
    };
  }

  // Fallback to S3 / Filebase
  if (s3Client && config) {
    await s3Client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    return {
      key,
      bucket: config.bucket,
      publicUrl: getPublicUrl(config, key),
    };
  }

  throw new Error('No storage backend configured.');
}

function getPublicUrl(config, key) {
  if (config.endpoint.includes('filebase.com')) {
    return `https://${encodeURIComponent(config.bucket)}.s3.filebase.com/${encodeURI(key)}`;
  }
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodeURI(key)}`;
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
    const folder = String(body.folder || 'products').replace(/[^a-zA-Z0-9_-]/g, '') || 'products';
    const isCustomerOrderProof = folder === 'orders';

    // ━━ SECURITY CHECK: Caller must be verified Admin or Authenticated Seller (except customer order screenshot proofs) ━━
    let isAdmin = false;
    let isSeller = false;

    if (!isCustomerOrderProof) {
      isAdmin = await verifyAdminRequest(req);
      const authHeader = req.headers.authorization || req.headers.Authorization || '';
      const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      const sellerId = String(body.sellerId || req.headers['x-seller-id'] || '').trim();
      const sellerToken = String(body.sellerToken || body.token || bearerToken || '').trim();
      const secret = getAuthSecret();

      if (sellerId && sellerToken && verifySellerToken(sellerId, sellerToken, secret)) {
        isSeller = true;
      }

      if (!isAdmin && !isSeller) {
        return res.status(401).json({ error: 'Unauthorized: Authentication required to upload files.' });
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
      const folder = String(body.folder || 'products').replace(/[^a-zA-Z0-9_-]/g, '') || 'products';
      const filename = String(body.filename || `${Date.now()}_asset.png`).replace(/[^a-zA-Z0-9_.-]/g, '_');
      const contentType = String(body.contentType || 'application/octet-stream');

      if (!uploadId || !totalParts || totalParts < 1) {
        return res.status(400).json({ error: 'Missing uploadId or totalParts for assembly.' });
      }

      const partBuffers = [];
      const supabaseUrl = process.env.SUPABASE_URL || 'https://dsleaglxbedljdxrikdn.supabase.co';
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
