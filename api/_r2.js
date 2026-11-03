import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFallback() {
  try {
    const p1 = path.resolve(__dirname, '../.env');
    const p2 = path.join(process.cwd(), '.env');
    const envPath = fs.existsSync(p1) ? p1 : (fs.existsSync(p2) ? p2 : null);
    if (envPath) {
      const raw = fs.readFileSync(envPath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
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

let _r2Client = null;

export function getR2Config() {
  loadEnvFallback();
  const endpoint = String(process.env.R2_ENDPOINT || '').replace(/\/+$/, '');
  const bucket = String(process.env.R2_BUCKET || 'linkadda-shop').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const publicUrl = String(process.env.R2_PUBLIC_URL || 'https://pub-81f10c1135f54a719e5d96e8d7896960.r2.dev').replace(/\/+$/, '');
  return { endpoint, bucket, accessKeyId, secretAccessKey, publicUrl };
}

export function getR2Client() {
  if (_r2Client) return _r2Client;
  const cfg = getR2Config();
  if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey) {
    return null;
  }
  _r2Client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return _r2Client;
}

export function getPublicR2Url(key) {
  const cfg = getR2Config();
  const cleanKey = String(key || '').replace(/^\/+/, '');
  return `${cfg.publicUrl}/${encodeURI(cleanKey)}`;
}

export async function uploadBufferToR2(key, buffer, contentType = 'image/jpeg') {
  const client = getR2Client();
  const cfg = getR2Config();
  if (!client) {
    throw new Error('Cloudflare R2 is not configured.');
  }
  const cleanKey = String(key || '').replace(/^\/+/, '');
  await client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: cleanKey,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  const publicUrl = getPublicR2Url(cleanKey);
  return { key: cleanKey, bucket: cfg.bucket, publicUrl };
}

export async function uploadBase64ToR2(folder, filename, base64String) {
  if (!base64String || typeof base64String !== 'string') return '';
  const trimmed = base64String.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  let base64Data = trimmed;
  let contentType = 'image/jpeg';
  if (trimmed.includes('base64,')) {
    const parts = trimmed.split('base64,');
    base64Data = parts[1];
    const mimeMatch = parts[0].match(/data:([^;]+);/);
    if (mimeMatch) contentType = mimeMatch[1];
  }

  const buffer = Buffer.from(base64Data, 'base64');
  const cleanFolder = String(folder || 'payment screenshot').replace(/^\/+|\/+$/g, '');
  const cleanFilename = String(filename || `proof_${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${cleanFolder}/${cleanFilename}`;

  const res = await uploadBufferToR2(key, buffer, contentType);
  return res.publicUrl;
}

