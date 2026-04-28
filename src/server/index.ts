import 'dotenv/config';
import path from 'path';
import express from 'express';
import cors from 'cors';
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

const allowedOrigins = [`http://localhost:${PORT}`];
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:5173');
}
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '10mb' }));

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

app.listen(PORT, () => {
  console.log(`Mail server running on http://localhost:${PORT}`);
});
