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

const PORT = process.env.PORT || 8899;

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
      const bust = `?bust=${Date.now()}`;
      if (pathname === '/api/upload') {
        const mod = await import(`./api/upload.js${bust}`);
        return await mod.default(req, resEnhanced);
      }
      if (pathname === '/api/auth/customer') {
        const mod = await import(`./api/auth/customer.js${bust}`);
        return await mod.default(req, resEnhanced);
      }
      if (pathname === '/api/admin/auth') {
        const mod = await import(`./api/admin/auth.js${bust}`);
        return await mod.default(req, resEnhanced);
      }
      if (pathname === '/api/admin/db') {
        const mod = await import(`./api/admin/db.js${bust}`);
        return await mod.default(req, resEnhanced);
      }
      if (pathname === '/api/telegram/broadcast') {
        const mod = await import(`./api/telegram/broadcast.js${bust}`);
        return await mod.default(req, resEnhanced);
      }
      if (pathname.startsWith('/api/telegram')) {
        const mod = await import(`./api/telegram/bot.js${bust}`);
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

  // ━━ SECURITY: BLOCK SENSITIVE FILES, DATA DIRECTORY, SERVER CODE & DOTFILES ━━
  const normalizedPath = path.normalize(pathname).replace(/\\/g, '/');
  const lowerPath = normalizedPath.toLowerCase();
  const BLOCKED_SYSTEM_FILES = ['database.rules.json', 'package.json', 'package-lock.json', 'vercel.json', '.gitignore', 'dev-server.mjs'];
  const BLOCKED_DIRS = ['/data/', '/data', '/api/', '/.git/', '/.gemini/'];
  const BLOCKED_EXTENSIONS = ['.env', '.git', '.sql', '.json', '.mjs', '.cjs', '.md', '.log', '.sh', '.bat', '.cmd', '.map'];

  const isBlockedDir = BLOCKED_DIRS.some(d => lowerPath === d || lowerPath.startsWith(d.endsWith('/') ? d : d + '/'));
  const isBlockedExt = BLOCKED_EXTENSIONS.some(ext => lowerPath.endsWith(ext) && !lowerPath.endsWith('manifest.json'));
  const isBlockedSystem = BLOCKED_SYSTEM_FILES.some(b => lowerPath.endsWith('/' + b) || lowerPath === '/' + b);
  const isHidden = lowerPath.includes('/.') || lowerPath.startsWith('/.');

  if (isHidden || isBlockedDir || isBlockedExt || isBlockedSystem) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: '403 Forbidden: Direct access to system data or source file is restricted.' }));
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 LinkAdda Server running at http://0.0.0.0:${PORT}`);
  
  // Permanent Webhook Watchdog: Keeps Telegram bot strictly locked to LinkAdda server
  import('./api/telegram/bot.js').then(({ ensureWebhookActive }) => {
    if (typeof ensureWebhookActive === 'function') {
      ensureWebhookActive().catch(() => {});
      setInterval(() => {
        ensureWebhookActive().catch(() => {});
      }, 60000);
    }
  }).catch(() => {});
});
