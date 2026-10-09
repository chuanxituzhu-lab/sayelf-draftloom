import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialDocument } from '../src/core.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function startDraftloom(port, apiUrl) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      WECHAT_APP_ID: 'synthetic-test-app-id',
      WECHAT_APP_SECRET: 'synthetic-test-app-secret',
      WECHAT_ACCESS_TOKEN: 'synthetic-test-token',
      WECHAT_DRAFT_API_URL: apiUrl
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let startupTimer;
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.on('data', chunk => { if (String(chunk).includes(`127.0.0.1:${port}`)) resolve(); });
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`本机服务启动失败（${code}）`)));
      }),
      new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('本机服务启动超时')), 30_000); })
    ]);
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    clearTimeout(startupTimer);
  }
  return child;
}

test('GUI draft submission keeps the local server responsive, prevents duplicate submits, and confirms receipt', async () => {
  let releaseDraft;
  let notifyDraftStarted;
  const draftStarted = new Promise(resolve => { notifyDraftStarted = resolve; });
  const draftApi = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume request body */ }
    notifyDraftStarted();
    await new Promise(resolve => { releaseDraft = resolve; });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errcode: 0, media_id: 'synthetic-draft-id' }));
  });
  const apiPort = await listen(draftApi);
  const appProbe = http.createServer();
  const port = await listen(appProbe);
  await new Promise(resolve => appProbe.close(resolve));
  const app = await startDraftloom(port, `http://127.0.0.1:${apiPort}/cgi-bin/draft/add`);
  const base = `http://127.0.0.1:${port}`;
  let result;
  try {
    const firstSubmit = fetch(`${base}/api/wechat/draft`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc: createInitialDocument(), confirm: true })
    });
    let submitTimer;
    let submitProgress;
    try {
      submitProgress = await Promise.race([
        draftStarted.then(() => ({ started: true })),
        firstSubmit.then(async response => ({ started: false, status: response.status, body: await response.clone().text() })),
        new Promise((_, reject) => { submitTimer = setTimeout(() => reject(new Error('提交处理既未调用模拟草稿接口，也未返回结果')), 30_000); })
      ]);
    } finally {
      clearTimeout(submitTimer);
    }
    assert.equal(submitProgress.started, true, `提交未到达模拟草稿接口：HTTP ${submitProgress.status || '?'} ${submitProgress.body || ''}`);

    const before = Date.now();
    const status = await fetch(`${base}/api/wechat/status`);
    assert.equal(status.status, 200);
    assert.ok(Date.now() - before < 400, '长时间发布操作不应阻塞授权/状态接口');

    const duplicate = await fetch(`${base}/api/wechat/draft`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doc: createInitialDocument(), confirm: true })
    });
    assert.equal(duplicate.status, 409);
    releaseDraft();
    result = await (await firstSubmit).json();
    assert.equal(result.delivery.status, 'submitted');
    assert.equal(result.delivery.draftId, 'synthetic-draft-id');
  } finally {
    releaseDraft?.();
    app.kill();
    await Promise.race([once(app, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
    draftApi.closeAllConnections();
    await new Promise(resolve => draftApi.close(resolve));
    if (result?.htmlPath) {
      const workDir = resolve(dirname(dirname(result.htmlPath)));
      const generatedRoot = resolve(projectRoot, '.local-data', 'gui-publish');
      if (workDir.startsWith(`${generatedRoot}${sep}`)) await rm(workDir, { recursive: true, force: true });
    }
  }
});
