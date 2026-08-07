/**
 * Tier 1 smoke tests — every API route answers without a 5xx.
 *
 * Runs against a throwaway server and empty database (see harness.js), so IDs
 * below are deliberately non-existent: the point is that missing rows produce a
 * clean 4xx rather than an unhandled exception. Where a status is asserted
 * exactly it is one the route contract guarantees; everything else only has to
 * avoid a server error.
 */
const FAKE_ID = '00000000-0000-0000-0000-000000000000';
const results = { passed: 0, failed: 0, errors: [] };

async function check(base, method, path, opts = {}) {
  const label = opts.description || `${method} ${path}`;
  const fetchOpts = { method, signal: AbortSignal.timeout(10000) };
  if (opts.body !== undefined) {
    fetchOpts.headers = { 'Content-Type': 'application/json' };
    fetchOpts.body = JSON.stringify(opts.body);
  }
  try {
    const res = await fetch(`${base}${path}`, fetchOpts);
    if (res.status >= 500) {
      results.failed++;
      results.errors.push(`FAIL [${label}] — server error ${res.status}`);
    } else if (opts.expect && res.status !== opts.expect) {
      results.failed++;
      results.errors.push(`FAIL [${label}] — expected ${opts.expect}, got ${res.status}`);
    } else {
      results.passed++;
    }
  } catch (err) {
    results.failed++;
    results.errors.push(`FAIL [${label}] — ${err.message}`);
  }
}

module.exports = async function run(port) {
  const B = `http://127.0.0.1:${port}`;
  results.passed = 0;
  results.failed = 0;
  results.errors = [];
  console.log(`\nSmoke tests against ${B}\n`);

  // Health and build
  await check(B, 'GET', '/api/health', { expect: 200 });
  await check(B, 'GET', '/api/build-status', { expect: 200 });

  // Accounts
  await check(B, 'GET', '/api/accounts', { expect: 200 });
  await check(B, 'POST', '/api/accounts/imap', {
    body: {},
    expect: 400,
    description: 'POST /api/accounts/imap rejects invalid body',
  });
  await check(B, 'POST', `/api/accounts/${FAKE_ID}/sync`);
  await check(B, 'DELETE', `/api/accounts/${FAKE_ID}`);

  // Folders
  await check(B, 'GET', `/api/folders/${FAKE_ID}`);
  await check(B, 'POST', `/api/folders/${FAKE_ID}/sync`);

  // Settings (must resolve before the /:id catch-all)
  await check(B, 'GET', '/api/messages/settings', { expect: 200 });
  await check(B, 'PUT', '/api/messages/settings', { body: {}, expect: 200 });

  // Message listing
  await check(B, 'GET', `/api/messages/folder/${FAKE_ID}`);
  await check(B, 'GET', `/api/messages/account/${FAKE_ID}`);
  await check(B, 'GET', '/api/messages/unified', { expect: 200 });
  await check(B, 'GET', `/api/messages/thread/${FAKE_ID}`);
  await check(B, 'GET', `/api/messages/search/${FAKE_ID}?q=test`);

  // Single message and attachments
  await check(B, 'GET', `/api/messages/${FAKE_ID}`);
  await check(B, 'GET', `/api/messages/${FAKE_ID}/headers`);
  await check(B, 'GET', `/api/messages/${FAKE_ID}/attachments`);
  await check(B, 'GET', `/api/messages/attachment/${FAKE_ID}`);
  await check(B, 'GET', `/api/messages/${FAKE_ID}/cid/abc`);

  // Mutations
  await check(B, 'PATCH', `/api/messages/${FAKE_ID}`, { body: { is_read: true } });
  await check(B, 'POST', `/api/messages/${FAKE_ID}/archive`);
  await check(B, 'POST', `/api/messages/${FAKE_ID}/spam`);
  await check(B, 'POST', `/api/messages/${FAKE_ID}/not-spam`);
  await check(B, 'POST', `/api/messages/${FAKE_ID}/move`, { body: { folder_id: FAKE_ID } });
  await check(B, 'DELETE', `/api/messages/${FAKE_ID}`);
  await check(B, 'DELETE', '/api/messages/spam-whitelist/example.com');
  await check(B, 'DELETE', `/api/messages/trash/${FAKE_ID}`);
  await check(B, 'DELETE', `/api/messages/spam/${FAKE_ID}`);

  // Send: invalid body must be rejected by validation before any SMTP contact.
  await check(B, 'POST', '/api/messages/send', {
    body: {},
    expect: 400,
    description: 'POST /api/messages/send rejects invalid body',
  });

  await check(B, 'GET', '/api/nonexistent', {
    expect: 404,
    description: 'Unknown route returns 404',
  });

  console.log(`  Results: ${results.passed} passed, ${results.failed} failed\n`);
  if (results.errors.length) {
    results.errors.forEach((e) => console.log(`  ${e}`));
    console.log();
  }
  return results.failed > 0 ? 1 : 0;
};
