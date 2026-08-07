/**
 * Self-contained test harness.
 *
 * Spawns the built server on its own port against a throwaway data dir, so the
 * suite runs on a bare CI runner with nothing already listening and never
 * touches ~/.mailclient-data. Usage: node tests/harness.js [smoke|integration]
 */
const { mkdtempSync, rmSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');
const { spawn } = require('child_process');
const crypto = require('crypto');

const TEST_PORT = 13200;

async function waitForServer(port, maxAttempts = 50) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server failed to start on port ${port}`);
}

async function run() {
  const dataDir = mkdtempSync(join(tmpdir(), 'mailclient-test-'));
  const serverPath = join(__dirname, '..', 'dist', 'server', 'index.js');

  const child = spawn('node', [serverPath], {
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      DATA_DIR: dataDir,
      // Throwaway key — the suite never handles real credentials.
      ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  child.stdout.on('data', (d) => (serverLog += d));
  child.stderr.on('data', (d) => (serverLog += d));

  let exitCode = 1;
  try {
    await waitForServer(TEST_PORT);
    console.log(`Test server on port ${TEST_PORT} (data: ${dataDir})`);

    // Literal paths: a computed require() is both a lint finding and a way to
    // load something unintended.
    const mode = process.argv[2] || 'smoke';
    const runTests = mode === 'integration' ? require('./integration.js') : require('./smoke.js');
    exitCode = await runTests(TEST_PORT);
  } catch (err) {
    console.error(`Harness failed: ${err.message}`);
    if (serverLog) console.error(`--- server output ---\n${serverLog}`);
  } finally {
    child.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
  }
  return exitCode;
}

run().then((code) => process.exit(code));
