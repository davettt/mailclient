/**
 * Tier 2 integration tests — the network exposure guards
 * (project-standards § Network Exposure) hold on the built server.
 *
 * Runs against a throwaway server and empty database (see harness.js).
 */
const http = require('http');
const assert = require('assert');

const FAKE_ID = '00000000-0000-0000-0000-000000000000';

// fetch() forbids overriding Host, so the rebinding test uses a raw request.
function rawGet(port, urlPath, host) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, headers: { host } },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function run(port) {
  const base = `http://127.0.0.1:${port}`;
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}: ${err.message}`);
    }
  }

  console.log(`\nIntegration tests against ${base}\n`);

  await test('health reports ok', async () => {
    const res = await fetch(`${base}/api/health`);
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.status, 'ok');
  });

  await test('accepts the app hosts', async () => {
    assert.strictEqual((await rawGet(port, '/api/health', `127.0.0.1:${port}`)).status, 200);
    assert.strictEqual((await rawGet(port, '/api/health', `localhost:${port}`)).status, 200);
  });

  await test('rejects requests with a foreign Host header (DNS rebinding)', async () => {
    const res = await rawGet(port, '/api/health', `evil.example:${port}`);
    assert.strictEqual(res.status, 403);
  });

  await test('sets security headers', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(res.headers.get('content-security-policy'), 'CSP present');
    assert.strictEqual(res.headers.get('x-powered-by'), null);
  });

  await test('does not grant CORS to other localhost origins', async () => {
    const res = await fetch(`${base}/api/health`, {
      headers: { origin: 'http://localhost:9999' },
    });
    assert.strictEqual(res.headers.get('access-control-allow-origin'), null);
    const own = await fetch(`${base}/api/health`, { headers: { origin: base } });
    assert.strictEqual(own.headers.get('access-control-allow-origin'), base);
  });

  await test('refuses cross-site writes but allows the app origin', async () => {
    const evil = { origin: 'https://evil.example' };
    const noBody = await fetch(`${base}/api/messages/${FAKE_ID}/archive`, {
      method: 'POST',
      headers: evil,
    });
    assert.strictEqual(noBody.status, 403, 'no-body POST');
    const put = await fetch(`${base}/api/messages/settings`, {
      method: 'PUT',
      headers: { ...evil, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(put.status, 403, 'PUT');
    const del = await fetch(`${base}/api/messages/${FAKE_ID}`, { method: 'DELETE', headers: evil });
    assert.strictEqual(del.status, 403, 'DELETE');
    const own = await fetch(`${base}/api/messages/settings`, {
      method: 'PUT',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(own.status, 200, 'own origin');
  });

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  return failed > 0 ? 1 : 0;
};
