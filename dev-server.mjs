import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';

if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
try {
  const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const k = trimmed.substring(0, idx).trim();
      const v = trimmed.substring(idx + 1).trim();
      process.env[k] = v;
    }
  });
} catch (_) {}

const PORT = 8899;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-folder, x-filename, x-action');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Enhance req and res with Express-like helpers for serverless functions
  const enhanceRes = (res) => {
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
      return res;
    };
    return res;
  };

  // Helper to parse JSON body
  const parseJsonBody = (req) => {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (_) {
          resolve(data || {});
        }
      });
      req.on('error', () => resolve({}));
    });
  };

  // ━━ API ROUTES ━━
  if (pathname.startsWith('/api/')) {
    const resEnhanced = enhanceRes(res);
    req.query = Object.fromEntries(url.searchParams.entries());

    if (req.method === 'POST' || req.method === 'PUT') {
      req.body = await parseJsonBody(req);
    }

    try {
      if (pathname === '/api/upload') {
        const mod = await import(`./api/upload.js${bust}`);
        return await mod.default(req, resEnhanced);
      }
      if (pathname === '/api/auth/customer') {
        const mod = await import(`./api/auth/customer.js${bust}`);
        return await mod.default(req, resEnhanced);
      }

      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'API route not found' }));
      return;
    } catch (err) {
      console.error('API Error:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // ━━ SECURITY: BLOCK DOTFILES & SENSITIVE FILES (.env, .git, config, rules) ━━
  const normalizedPath = path.normalize(pathname).replace(/\\/g, '/');
  const lowerPath = normalizedPath.toLowerCase();
  const BLOCKED_SYSTEM_FILES = ['database.rules.json', 'package.json', 'package-lock.json', 'vercel.json', '.gitignore', 'dev-server.mjs'];

  if (
    lowerPath.includes('/.') ||
    lowerPath.startsWith('/.') ||
    lowerPath.includes('.env') ||
    lowerPath.includes('.git') ||
    BLOCKED_SYSTEM_FILES.some(b => lowerPath.endsWith('/' + b) || lowerPath === '/' + b)
  ) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'text/plain');
    res.end('403 Forbidden: Access to sensitive system file is restricted.');
    return;
  }

  // ━━ REDIRECT .html TO CLEAN EXTENSIONLESS URLS ━━
  if (pathname.endsWith('.html')) {
    const clean = pathname.replace(/\.html$/, '');
    const target = clean.endsWith('/index') ? clean.slice(0, -6) || '/' : clean;
    res.statusCode = 301;
    res.setHeader('Location', target + (url.search || ''));
    res.end();
    return;
  }

  // ━━ STATIC FILE ROUTING ━━
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  if (pathname === '/login' || pathname.startsWith('/seller')) {
    res.statusCode = 301;
    res.setHeader('Location', '/');
    res.end();
    return;
  }
  if (pathname === '/about') filePath = path.join(__dirname, 'about.html');
  if (pathname === '/payment') filePath = path.join(__dirname, 'payment.html');
  if (pathname === '/admin' || pathname === '/admin/') filePath = path.join(__dirname, 'admin', 'index.html');
  if (pathname === '/admin/login' || pathname === '/admin/login/') filePath = path.join(__dirname, 'admin', 'login.html');
  if (pathname.startsWith('/assets/')) filePath = path.join(__dirname, 'admin', pathname);

  if (!path.extname(pathname) && !fs.existsSync(filePath)) {
    const candidateHtml = path.join(__dirname, `${pathname}.html`);
    if (fs.existsSync(candidateHtml)) {
      filePath = candidateHtml;
    }
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // If directory, try index.html
      if (stats && stats.isDirectory()) {
        const indexFile = path.join(filePath, 'index.html');
        if (fs.existsSync(indexFile)) {
          filePath = indexFile;
        } else {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }
      } else {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    if (ext === '.html' || pathname === '/') {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (['.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    } else if (['.css', '.js', '.mjs'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 LinkAdda Local Dev Server running at http://localhost:${PORT}`);
});
