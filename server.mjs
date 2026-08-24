import http from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyProtectedLocalConfig } from './scripts/local-config.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
applyProtectedLocalConfig(root);
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'
};
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
const authPath = join(root, '.local-data', 'wechat-auth.json');
async function readJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 14_000_000) throw new Error('请求内容过大');
  }
  return text ? JSON.parse(text) : {};
}
async function readSavedAuth() {
  try {
    const saved = JSON.parse(await readFile(authPath, 'utf8'));
    if (!saved?.access_token) return null;
    if (saved.expires_at && Date.parse(saved.expires_at) <= Date.now() + 30_000) return null;
    return saved;
  } catch { return null; }
}
async function saveAuth(input = {}) {
  if (!input.access_token || typeof input.access_token !== 'string') throw new Error('授权回调缺少 access_token');
  const rawExpiresIn = Number(input.expires_in || 7200);
  const expiresIn = Number.isFinite(rawExpiresIn) && rawExpiresIn > 0 ? rawExpiresIn : 7200;
  const saved = {
    access_token: input.access_token,
    refresh_token: input.refresh_token || null,
    appid: input.appid || process.env.WECHAT_APP_ID || process.env.WX_APPID || null,
    expires_at: new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000).toISOString(),
    authorized_at: new Date().toISOString()
  };
  await mkdir(join(root, '.local-data'), { recursive: true });
  await writeFile(authPath, JSON.stringify(saved, null, 2), 'utf8');
  return { authorized: true, persisted: true, expiresAt: saved.expires_at };
}
async function wechatStatus() {
  const saved = await readSavedAuth();
  const hasToken = Boolean(process.env.WECHAT_ACCESS_TOKEN || process.env.WX_ACCESS_TOKEN) || Boolean(saved?.access_token);
  const hasAppCredentials = Boolean((process.env.WECHAT_APP_ID || process.env.WX_APPID) && (process.env.WECHAT_APP_SECRET || process.env.WX_APPSECRET));
  const qrAuthUrl = process.env.WECHAT_QR_AUTH_URL || null;
  const qrImageUrl = process.env.WECHAT_QR_IMAGE_URL || null;
  return {
    remoteReady: hasToken || hasAppCredentials,
    authorized: hasToken,
    persisted: Boolean(saved?.access_token),
    expiresAt: saved?.expires_at || null,
    qrAuthorization: Boolean(qrAuthUrl || qrImageUrl),
    qrAuthUrl,
    qrImageUrl,
    callbackUrl: process.env.WECHAT_QR_CALLBACK_URL || `http://127.0.0.1:${port}/api/wechat/auth/callback`,
    mode: hasToken || hasAppCredentials ? 'wechat-api' : 'local-bundle',
    message: '授权凭据仅保存在本机 .local-data；下次启动会自动复用。二维码由已配置的授权适配器提供。'
  };
}
async function publishGuiDocument(doc, confirm = false) {
  if (confirm !== true) throw new Error('提交草稿箱前必须显式确认');
  if (!doc || typeof doc.title !== 'string' || !Array.isArray(doc.blocks) || !Array.isArray(doc.assets) || !doc.meta) throw new Error('文章状态格式不正确');
  const workDir = join(root, '.local-data', 'gui-publish', `${Date.now()}-${process.pid}`);
  const dataPath = join(workDir, 'document.json');
  const outPath = join(workDir, 'bundle');
  await mkdir(workDir, { recursive: true });
  const state = { doc, selectedId: doc.blocks[0]?.id || null, history: [{ seq: doc.meta?.revision || 1, ts: doc.meta?.updatedAt || new Date().toISOString(), label: 'GUI 导出', doc }], future: [] };
  await writeFile(dataPath, JSON.stringify(state, null, 2), 'utf8');
  try {
    const output = execFileSync(process.execPath, [join(root, 'scripts', 'cli.mjs'), 'draft-submit', '--confirm', 'true', '--data', dataPath, '--out', outPath], { cwd: root, encoding: 'utf8', env: process.env, maxBuffer: 2_000_000 });
    return JSON.parse(output);
  } catch (error) {
    const detail = error.stderr?.toString()?.trim() || error.stdout?.toString()?.trim() || error.message;
    throw new Error(detail);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const raw = decodeURIComponent((req.url || '/').split('?')[0]);
    if (raw === '/api/wechat/status' && req.method === 'GET') return json(res, 200, await wechatStatus());
    if (raw === '/api/wechat/auth/callback' && req.method === 'POST') {
      const body = await readJson(req);
      return json(res, 200, await saveAuth(body));
    }
    if (raw === '/api/wechat/draft' && req.method === 'POST') { const body = await readJson(req); return json(res, 200, await publishGuiDocument(body.doc, body.confirm === true)); }
    const rel = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
    const safe = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = join(root, safe);
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not file');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (error) {
    if ((req.url || '').startsWith('/api/')) return json(res, 400, { error: error.message });
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`WeChat Layout MVP: http://127.0.0.1:${port}`);
});
