import 'dotenv/config';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import accountRoutes from './routes/accounts';
import folderRoutes from './routes/folders';
import messageRoutes from './routes/messages';
import { imapService } from './services/imap';
import { checkBuildStale } from './utils/buildCheck';

if (!process.env.ENCRYPTION_KEY) {
  console.error(
    "FATAL: ENCRYPTION_KEY not set. Run: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" and add to .env",
  );
  process.exit(1);
}
const keyBuf = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
if (keyBuf.length !== 32) {
  console.error('FATAL: ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  process.exit(1);
}

const app = express();
const PORT = parseInt(process.env.PORT || '3200');

// Network exposure guards (project-standards § Network Exposure). The API has no
// authentication, so the only client must be the app's own window.
const HOST = process.env.HOST || '127.0.0.1';
const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const allowedOrigins = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
if (process.env.NODE_ENV !== 'production') {
  // Vite dev server proxies /api; the browser's Origin is the Vite origin.
  allowedOrigins.add('http://localhost:5173');
  allowedOrigins.add('http://127.0.0.1:5173');
}

app.disable('x-powered-by');

// 1. Host check: loopback binding does not stop DNS rebinding, where a website
// re-resolves its own domain to 127.0.0.1 and reads the API through the
// user's browser. That request carries the attacker's hostname.
app.use((req, res, next) => {
  const host = req.headers.host;
  if (!host || !allowedHosts.has(host)) {
    return res.status(403).json({ error: 'Invalid host' });
  }
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' scripts: the flash-free theme bootstrap in index.html, and the
        // height-reporting script inside the sandboxed srcdoc iframe that renders email
        // HTML (a srcdoc document inherits this CSP). The iframe has no allow-same-origin,
        // so email content cannot reach the app's origin regardless.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        // 'unsafe-inline' styles: React inline style attributes and email HTML styling.
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Email HTML references remote images; cid: images are served from /api.
        imgSrc: ["'self'", 'data:', 'https:', 'http:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
  }),
);

// 3. Exact-origin CORS: a regex on localhost would admit every other local dev server.
app.use(
  cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
  }),
);

// 4. Refuse cross-site writes. CORS only stops a website reading the response; a page
// the user visits can still send a form POST or a no-body POST to 127.0.0.1 and the
// route runs. Browsers always send Origin on cross-site requests. A missing Origin
// (curl, the test runner) is allowed; the Host check above still applies.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: 'Cross-site request refused' });
  }
  next();
});

app.use(express.json({ limit: '50mb' }));

app.use('/api/accounts', accountRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/messages', messageRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/build-status', (_req, res) => {
  res.json(checkBuildStale());
});

if (process.env.NODE_ENV === 'production') {
  const clientDir = path.join(__dirname, '../client');
  app.use(
    '/assets',
    express.static(path.join(clientDir, 'assets'), { maxAge: '1y', immutable: true }),
  );
  app.use(express.static(clientDir, { maxAge: 0 }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await imapService.disconnectAll();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await imapService.disconnectAll();
  process.exit(0);
});

// 2. Bind to loopback only: without a host Node listens on every interface and the
// unauthenticated API is reachable by anyone on the same network.
app.listen(PORT, HOST, () => {
  console.log(`Mail server running on http://${HOST}:${PORT}`);
});
