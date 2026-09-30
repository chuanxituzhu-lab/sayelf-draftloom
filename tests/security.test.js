import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { authFilePath, readProtectedAuth, saveProtectedAuth } from '../scripts/local-auth.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

async function availablePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  probe.close();
  await once(probe, 'close');
  return port;
}

test('local server serves only public assets and rejects untrusted callback and origin', async () => {
  const port = await availablePort();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), WECHAT_QR_AUTH_URL: 'https://auth.example.invalid/start', WECHAT_QR_IMAGE_URL: 'https://assets.example.invalid/qr.png', WECHAT_QR_CALLBACK_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  try {
    await Promise.race([
      new Promise((resolveReady, rejectReady) => {
        child.stdout.on('data', chunk => { if (String(chunk).includes(`127.0.0.1:${port}`)) resolveReady(); });
        child.once('error', rejectReady);
        child.once('exit', code => rejectReady(new Error(`服务启动失败 (${code})`)));
      }),
      new Promise((_, rejectReady) => setTimeout(() => rejectReady(new Error('服务启动超时')), 10_000))
    ]);
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/.local-data/draftloom.config.json`)).status, 404);
    assert.equal((await fetch(`${base}/scripts/local-auth.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/.git/config`)).status, 404);
    assert.equal((await fetch(`${base}/src/app.js`)).status, 200);
    const status = await (await fetch(`${base}/api/wechat/status`)).json();
    assert.equal(status.qrGenerated, true);
    assert.match(status.qrAuthUrl, /draftloom_state=/);
    assert.match(status.qrImageUrl, /^data:image\/png;base64,/);
    const denied = await fetch(`${base}/api/wechat/auth/callback`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ access_token: 'synthetic-test-token', draftloom_state: 'wrong-state' })
    });
    assert.equal(denied.status, 403);
    const foreignOrigin = await fetch(`${base}/api/wechat/auth/callback`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://untrusted.example' },
      body: JSON.stringify({ access_token: 'synthetic-test-token' })
    });
    assert.equal(foreignOrigin.status, 403);
  } finally {
    child.kill();
    await Promise.race([once(child, 'exit'), new Promise(resolveDone => setTimeout(resolveDone, 3000))]);
  }
});

test('Windows callback token is DPAPI-protected and legacy plaintext migrates', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftloom-auth-test-'));
  try {
    const path = authFilePath(root);
    const secret = 'synthetic-test-token-not-real';
    saveProtectedAuth(root, { access_token: secret, appid: 'test-appid' });
    const stored = await readFile(path, 'utf8');
    assert.doesNotMatch(stored, /synthetic-test-token-not-real/);
    assert.equal(readProtectedAuth(root)?.access_token, secret);
    await writeFile(path, JSON.stringify({ access_token: secret, appid: 'test-appid' }), 'utf8');
    assert.equal(readProtectedAuth(root)?.access_token, secret);
    assert.doesNotMatch(await readFile(path, 'utf8'), /synthetic-test-token-not-real/);
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir(), 'draftloom-auth-test-'))) throw new Error('临时测试路径不安全');
    await rm(root, { recursive: true, force: true });
  }
});
