/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const http = require('node:http');
const fixtures = require('./visual/musician-fixtures.cjs');
test('synthetic fixtures cover pagination, literal search, empty and error', () => {
  const first = fixtures.page('', 0), second = fixtures.page('', 20), last = fixtures.page('', 40);
  assert.equal(first.musicians.length, 20); assert.equal(second.musicians.length, 20); assert.equal(last.musicians.length, 7);
  assert.equal(first.hasNext, true); assert.equal(last.hasNext, false);
  assert.ok(first.musicians.some(row => row.available)); assert.ok(first.musicians.some(row => !row.available));
  assert.ok(fixtures.page('ana', 0).musicians.every(row => row.name.toLowerCase().includes('ana')));
  assert.equal(fixtures.page('%_', 0).musicians.length, 0);
  assert.equal(fixtures.page('', 0, 'empty').musicians.length, 0);
  assert.throws(() => fixtures.page('', 0, 'error'));
});
test('preview refuses production before preparing files or starting a server', () => {
  const result = spawnSync(process.execPath, ['scripts/preview-musician-discovery.cjs', '--check'], {
    env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1); assert.match(result.stderr, /disabled in production/);
});
function get(url, headers = {}) {
  return new Promise((resolve, reject) => http.get(url, { headers }, response => {
    let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
  }).on('error', reject));
}
test('standalone preview serves only local static assets with network disabled', { timeout: 40000 }, async () => {
  const child = spawn(process.execPath, ['scripts/preview-musician-discovery.cjs'], { env: { ...process.env, NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Preview start timed out')), 30000);
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('Open http://')) { clearTimeout(timer); resolve(); } });
      child.on('exit', code => { clearTimeout(timer); reject(Error(`Preview exited: ${code}`)); });
    });
    const page = await get('http://127.0.0.1:4317/');
    assert.equal(page.status, 200); assert.match(page.body, /Descobrir músicos/);
    assert.match(page.headers['content-security-policy'], /connect-src 'none'/);
    assert.equal((await get('http://127.0.0.1:4317/preview.js')).status, 200);
    assert.equal((await get('http://127.0.0.1:4317/preview.css')).status, 200);
    assert.equal((await get('http://127.0.0.1:4317/api/mocks')).status, 404);
    assert.equal((await get('http://127.0.0.1:4317/', { Host: 'other.example' })).status, 403);
  } finally { child.kill(); }
});
