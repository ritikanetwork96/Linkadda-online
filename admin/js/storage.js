import { RUSTFS_CONFIG, SUPABASE_CONFIG } from './config.js';
import { uid } from './utils.js';
import { auth } from './firebase.js';

async function getUploadAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  try {
    if (auth && auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
  } catch (_) {}
  return headers;
}

const SUPABASE_API_KEY = SUPABASE_CONFIG?.serviceKey || SUPABASE_CONFIG?.anonKey || '';
const SUPABASE_STORAGE_ROOT = `${SUPABASE_CONFIG.url}/storage/v1/object`;
const RUSTFS_STORAGE_ROOT = `${RUSTFS_CONFIG.endpoint}/${encodeURIComponent(RUSTFS_CONFIG.bucket)}`;

function joinPath(...parts) {
  return parts
    .map((part) => String(part || '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

export function getRustfsUrl(path) {
  const clean = String(path || '').replace(/^\/+/, '');
  return `${RUSTFS_STORAGE_ROOT}/${encodeURI(clean)}`;
}

export function getSupabaseUrl(path) {
  const clean = String(path || '').replace(/^\/+/, '');
  return `${SUPABASE_STORAGE_ROOT}/public/${encodeURIComponent(SUPABASE_CONFIG.bucket)}/${encodeURI(clean)}`;
}

export function getPublicUrl(path) {
  const clean = String(path || '').trim();
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean) || clean.startsWith('data:') || clean.startsWith('blob:')) {
    if (clean.includes('rustfs-mi5c.srv1942099.hstgr.cloud') || clean.includes('s3.linkadda.shop')) {
      const pathPart = clean.split('/linkadda-media/').pop() || clean.split('/').pop();
      return getSupabaseUrl(pathPart);
    }
    return clean;
  }
  return getSupabaseUrl(clean);
}

function validateUploadFile(file) {
  if (!file || typeof file !== 'object') {
    throw new Error('No file selected.');
  }
  const type = String(file.type || '').toLowerCase();
  const isImage = type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(file.name || '');
  const isVideo = type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogg)$/i.test(file.name || '');

  if (!isImage && !isVideo) {
    throw new Error('Only image and video uploads are allowed.');
  }

  if (isImage) {
    const allowedImages = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'];
    if (!allowedImages.includes(type) && !/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(file.name || '')) {
      throw new Error('Unsupported image format.');
    }
    const maxImageBytes = 30 * 1024 * 1024; // 30 MB
    if (Number(file.size || 0) > maxImageBytes) {
      throw new Error('Image is too large. Max size is 30 MB.');
    }
  }

  if (isVideo) {
    const allowedVideos = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/ogg'];
    if (!allowedVideos.includes(type) && !file.name?.match(/\.(mp4|webm|mov|m4v|ogg)$/i)) {
      throw new Error('Unsupported video format.');
    }
    const maxVideoBytes = 150 * 1024 * 1024; // 150 MB
    if (Number(file.size || 0) > maxVideoBytes) {
      throw new Error('Video is too large. Max size is 150 MB.');
    }
  }
}

export function getStoragePath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    
    // Check RustFS pattern: /linkadda-media/path
    const rustfsMarker = `/${encodeURIComponent(RUSTFS_CONFIG.bucket)}/`;
    const rustfsIdx = url.pathname.indexOf(rustfsMarker);
    if (rustfsIdx >= 0) {
      return decodeURIComponent(url.pathname.slice(rustfsIdx + rustfsMarker.length));
    }

    // Check Supabase pattern: /storage/v1/object/public/media/path
    const supaMarker = `/storage/v1/object/public/${encodeURIComponent(SUPABASE_CONFIG.bucket)}/`;
    const supaIdx = url.pathname.indexOf(supaMarker);
    if (supaIdx >= 0) {
      return decodeURIComponent(url.pathname.slice(supaIdx + supaMarker.length));
    }
  } catch (_) {
    // Not a URL, fall back to the raw value.
  }
  return raw.split('?')[0].split('#')[0].replace(/^\/+/, '');
}

export async function deletePublicAsset(path) {
  const storagePath = getStoragePath(path);
  if (!storagePath) return;

  const isSupabase = String(path || '').includes('supabase.co');

  if (isSupabase) {
    try {
      const res = await fetch(`${SUPABASE_STORAGE_ROOT}/${encodeURIComponent(SUPABASE_CONFIG.bucket)}/${encodeURI(storagePath)}`, {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_API_KEY,
          Authorization: `Bearer ${SUPABASE_API_KEY}`,
        },
      });
      return res;
    } catch (e) {
      console.warn('Supabase delete error (skipped):', e);
    }
  }

  return true;
}

/**
 * Compress an image in the browser using canvas for instant fast uploads & storage
 */
async function compressImage(file, maxDimension = 1400, quality = 0.85) {
  if (file.type === 'image/svg+xml' || file.type === 'image/gif' || file.size <= 800 * 1024) {
    return file; // SVGs, GIFs, and lightweight images (<800KB) upload immediately without overhead
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(file), 2500); // 2.5s maximum safeguard
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const mime = file.type === 'image/png' && width <= 500 && height <= 500 ? 'image/png' : 'image/webp';
          canvas.toBlob((blob) => {
            clearTimeout(timer);
            if (blob && blob.size < file.size) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, mime === 'image/webp' ? '.webp' : '.png'), { type: mime }));
            } else {
              resolve(file);
            }
          }, mime, quality);
        } catch (_) {
          clearTimeout(timer);
          resolve(file);
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(file);
      };
      img.src = e.target.result;
    };
    reader.onerror = () => {
      clearTimeout(timer);
      resolve(file);
    };
    reader.readAsDataURL(file);
  });
}

function readFileAsDataUrl(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(fileOrBlob);
  });
}

/**
 * Universal Asset Uploader:
 * 1. Small files (<= 2.5MB): Direct fast upload to `/api/upload`.
 * 2. Large files (> 2.5MB, e.g. 6MB, 15MB images, or videos up to 150MB):
 *    Automatically slices file into 2MB chunks and uploads via `/api/upload`,
 *    then signals the server to assemble them in RustFS S3.
 * 3. Never blocked by Vercel's 4.5MB serverless payload limit.
 */
export async function uploadAsset(file, folder = 'products', onProgress) {
  validateUploadFile(file);

  if (typeof onProgress === 'function') onProgress(5);

  const ext = (file.name && file.name.includes('.'))
    ? file.name.split('.').pop()
    : (file.type && file.type.includes('/'))
      ? file.type.split('/').pop()
      : 'png';
  const cleanExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const fileName = `${Date.now()}_${uid('asset')}.${cleanExt}`;
  const path = joinPath(folder, fileName);

  // For logos and QR codes, use dedicated dimensions
  const maxDim = (folder === 'logos' || folder === 'qrcodes') ? 600 : 1600;
  let fileToUpload = file;
  if (file.type?.startsWith('image/')) {
    try {
      fileToUpload = await compressImage(file, maxDim, 0.85);
    } catch (_) {
      fileToUpload = file;
    }
  }

  if (typeof onProgress === 'function') onProgress(15);

  // ━━ 1. PRIMARY: DIRECT SUPABASE STORAGE UPLOAD (Instant, handles images & videos up to 50MB, no Vercel limit) ━━
  try {
    if (typeof onProgress === 'function') onProgress(30);
    const endpoint = `${SUPABASE_CONFIG.url}/storage/v1/object/${encodeURIComponent(SUPABASE_CONFIG.bucket)}/${encodeURI(path)}`;
    const supaRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_API_KEY,
        Authorization: `Bearer ${SUPABASE_API_KEY}`,
        'x-upsert': 'true',
        'Content-Type': fileToUpload.type || file.type || 'application/octet-stream',
      },
      body: fileToUpload,
    });

    if (supaRes.ok) {
      const publicUrl = `${SUPABASE_CONFIG.url}/storage/v1/object/public/${encodeURIComponent(SUPABASE_CONFIG.bucket)}/${encodeURI(path)}`;
      if (typeof onProgress === 'function') onProgress(100);
      return {
        path,
        publicUrl,
        rustfsUrl: publicUrl,
        dataUrl: '',
      };
    } else {
      console.warn(`Direct Supabase upload returned status ${supaRes.status}: ${supaRes.statusText}`);
    }
  } catch (supaErr) {
    console.warn('Direct Supabase upload network error, trying /api/upload fallback:', supaErr);
  }

  const CHUNK_THRESHOLD = 2.5 * 1024 * 1024; // 2.5 MB

  // ━━ 2. FALLBACK A: DIRECT UPLOAD VIA /api/upload (<= 2.5 MB) & QR/LOGOS ━━
  if (fileToUpload.size <= CHUNK_THRESHOLD || folder === 'qrcodes' || folder === 'logos') {
    const dataUrl = await readFileAsDataUrl(fileToUpload);
    if (typeof onProgress === 'function') onProgress(60);

    let uploadOk = false;
    let data = null;

    try {
      const authHeaders = await getUploadAuthHeaders();
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          folder,
          filename: fileName,
          base64: dataUrl,
          contentType: fileToUpload.type || file.type || 'image/png',
        }),
      });

      if (res.ok) {
        data = await res.json();
        uploadOk = true;
      } else {
        console.warn(`/api/upload responded with status ${res.status}: ${res.statusText}`);
      }
    } catch (networkErr) {
      console.warn('Direct upload fetch error:', networkErr);
    }

    if (uploadOk && data && (data.publicUrl || data.key)) {
      if (typeof onProgress === 'function') onProgress(100);
      return {
        path: data.key || path,
        publicUrl: data.publicUrl,
        rustfsUrl: data.publicUrl,
        dataUrl,
      };
    }

    // Offline / local fallback for QR codes, logos, and images
    if (folder === 'qrcodes' || folder === 'logos' || fileToUpload.size <= CHUNK_THRESHOLD || fileToUpload.type?.startsWith('image/')) {
      if (typeof onProgress === 'function') onProgress(100);
      return {
        path,
        publicUrl: dataUrl,
        rustfsUrl: dataUrl,
        dataUrl,
      };
    }

    throw new Error('Upload failed. Please check network and storage configuration.');
  }

  // ━━ 3. FALLBACK B: CHUNKED UPLOAD VIA /api/upload FOR LARGE FILES (> 2.5 MB) ━━
  const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB per slice
  const totalParts = Math.ceil(fileToUpload.size / CHUNK_SIZE);
  const uploadId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  for (let i = 0; i < totalParts; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(fileToUpload.size, start + CHUNK_SIZE);
    const slice = fileToUpload.slice(start, end);
    const chunkDataUrl = await readFileAsDataUrl(slice);

    const chunkAuthHeaders = await getUploadAuthHeaders();
    const chunkRes = await fetch('/api/upload', {
      method: 'POST',
      headers: chunkAuthHeaders,
      body: JSON.stringify({
        action: 'chunk',
        uploadId,
        partIndex: i,
        base64: chunkDataUrl,
      }),
    });

    if (!chunkRes.ok) {
      let errMsg = `Failed uploading chunk ${i + 1} of ${totalParts}.`;
      try {
        const errJson = await chunkRes.json();
        if (errJson?.error) errMsg = errJson.error;
      } catch (_) {}
      throw new Error(errMsg);
    }

    const pct = Math.round(15 + ((i + 1) / totalParts) * 75);
    if (typeof onProgress === 'function') onProgress(pct);
  }

  // Final Assembly Step
  if (typeof onProgress === 'function') onProgress(93);

  const assembleAuthHeaders = await getUploadAuthHeaders();
  const assembleRes = await fetch('/api/upload', {
    method: 'POST',
    headers: assembleAuthHeaders,
    body: JSON.stringify({
      action: 'assemble',
      uploadId,
      totalParts,
      folder,
      filename: fileName,
      contentType: fileToUpload.type || file.type || 'application/octet-stream',
    }),
  });

  if (!assembleRes.ok) {
    try {
      const endpoint = `${SUPABASE_CONFIG.url}/storage/v1/object/${encodeURIComponent(SUPABASE_CONFIG.bucket)}/${encodeURI(path)}`;
      const supaRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_API_KEY,
          Authorization: `Bearer ${SUPABASE_API_KEY}`,
          'x-upsert': 'true',
          'Content-Type': fileToUpload.type || file.type || 'application/octet-stream',
        },
        body: fileToUpload,
      });
      if (supaRes.ok) {
        const publicUrl = `${SUPABASE_CONFIG.url}/storage/v1/object/public/${encodeURIComponent(SUPABASE_CONFIG.bucket)}/${encodeURI(path)}`;
        if (typeof onProgress === 'function') onProgress(100);
        return {
          path,
          publicUrl,
          rustfsUrl: publicUrl,
          dataUrl: '',
        };
      }
    } catch (_) {}

    if (fileToUpload.type?.startsWith('image/')) {
      try {
        const fallbackDataUrl = await readFileAsDataUrl(fileToUpload);
        if (fallbackDataUrl) {
          if (typeof onProgress === 'function') onProgress(100);
          return {
            path,
            publicUrl: fallbackDataUrl,
            rustfsUrl: fallbackDataUrl,
            dataUrl: fallbackDataUrl,
          };
        }
      } catch (_) {}
    }

    let errMsg = 'Failed to assemble uploaded media parts.';
    try {
      const errJson = await assembleRes.json();
      if (errJson?.error) errMsg = errJson.error;
    } catch (_) {}
    throw new Error(errMsg);
  }

  const resultData = await assembleRes.json();
  if (typeof onProgress === 'function') onProgress(100);

  return {
    path: resultData.key || path,
    publicUrl: resultData.publicUrl,
    rustfsUrl: resultData.publicUrl,
    dataUrl: '',
  };
}
