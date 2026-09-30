import http from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyProtectedLocalConfig } from './scripts/local-config.mjs';
import { extractLocalDocument, MAX_DOCUMENT_BYTES } from './scripts/document-extract.mjs';
import { normalizeQrAuthUrl, qrDataUrlForAuthUrl } from './src/qr-auth.js';
import { readProtectedAuth, saveProtectedAuth } from './scripts/local-auth.mjs';

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
const QR_STATE_LIFETIME_MS = 10 * 60 * 1000;
let qrChallenge = { value: '', expiresAt: 0, issued: false };

function forbidden(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function assertLocalRequest(req) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)) throw forbidden('仅允许通过本机地址访问');
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) throw forbidden('跨站请求已拒绝');
}

function publicFilePath(raw) {
  const rel = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
  if (rel.includes('\\') || rel.split('/').some(part => part === '.' || part === '..')) return null;
  const allowed = rel === 'index.html'
    || /^src\/[a-z0-9-]+\.(?:js|css)$/i.test(rel)
    || /^assets\/[a-z0-9-]+\.(?:png|svg)$/i.test(rel)
    || /^node_modules\/gsap\/[a-z0-9-]+\.js$/i.test(rel);
  return allowed ? join(root, rel) : null;
}

function sameSecret(actual, expected) {
  const a = Buffer.from(String(actual || ''));
  const b = Buffer.from(String(expected || ''));
  return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function currentQrChallenge() {
  if (!qrChallenge.value || Date.now() >= qrChallenge.expiresAt) {
    qrChallenge = { value: randomBytes(32).toString('hex'), expiresAt: Date.now() + QR_STATE_LIFETIME_MS, issued: false };
  }
  return qrChallenge;
}
async function readJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 14_000_000) throw new Error('请求内容过大');
  }
  return text ? JSON.parse(text) : {};
}
async function readBuffer(req, maxBytes = MAX_DOCUMENT_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error(`文档超过本地导入上限（${maxBytes / 1024 / 1024}MB）`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}
function requestFilename(req) {
  const raw = String(req.headers['x-file-name'] || 'document');
  try { return decodeURIComponent(raw); } catch { return raw; }
}
async function readSavedAuth() {
  return readProtectedAuth(root);
}
async function saveAuth(input = {}) {
  if (!input.access_token || typeof input.access_token !== 'string') throw new Error('授权回调缺少 access_token');
  const configuredAppId = process.env.WECHAT_APP_ID || process.env.WX_APPID;
  if (configuredAppId && input.appid && input.appid !== configuredAppId) throw forbidden('公众号 AppID 与本机配置不一致');
  const validState = qrChallenge.issued && Date.now() < qrChallenge.expiresAt && sameSecret(input.draftloom_state || input.state, qrChallenge.value);
  const validAdapterSecret = sameSecret(input.callback_secret, process.env.WECHAT_QR_CALLBACK_SECRET);
  if (!validState && !validAdapterSecret) throw forbidden('授权回调缺少有效的一次性 state 或适配器密钥');
  const rawExpiresIn = Number(input.expires_in || 7200);
  const expiresIn = Number.isFinite(rawExpiresIn) && rawExpiresIn > 0 ? rawExpiresIn : 7200;
  const saved = {
    access_token: input.access_token,
    refresh_token: input.refresh_token || null,
    appid: input.appid || process.env.WECHAT_APP_ID || process.env.WX_APPID || null,
    expires_at: new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000).toISOString(),
    authorized_at: new Date().toISOString()
  };
  const result = saveProtectedAuth(root, saved);
  if (validState) qrChallenge = { value: '', expiresAt: 0, issued: false };
  return result;
}

let qrCache = { authUrl: '', imageUrl: null, error: null };
async function generatedQrImage(authUrl) {
  if (!authUrl) return { imageUrl: null, generated: false, error: null };
  if (qrCache.authUrl === authUrl && qrCache.imageUrl) return { imageUrl: qrCache.imageUrl, generated: true, error: null };
  try {
    const imageUrl = await qrDataUrlForAuthUrl(authUrl);
    qrCache = { authUrl, imageUrl, error: null };
    return { imageUrl, generated: true, error: null };
  } catch (error) {
    qrCache = { authUrl, imageUrl: null, error: error.message };
    return { imageUrl: null, generated: false, error: error.message };
  }
}

async function wechatStatus() {
  const saved = await readSavedAuth();
  const hasToken = Boolean(process.env.WECHAT_ACCESS_TOKEN || process.env.WX_ACCESS_TOKEN) || Boolean(saved?.access_token);
  const hasAppCredentials = Boolean((process.env.WECHAT_APP_ID || process.env.WX_APPID) && (process.env.WECHAT_APP_SECRET || process.env.WX_APPSECRET));
  const rawQrAuthUrl = process.env.WECHAT_QR_AUTH_URL || '';
  const normalizedQrAuth = normalizeQrAuthUrl(rawQrAuthUrl);
  const qrAuthUrl = normalizedQrAuth.url ? new URL(normalizedQrAuth.url) : null;
  if (qrAuthUrl) {
    const challenge = currentQrChallenge();
    challenge.issued = true;
    qrAuthUrl.searchParams.set('draftloom_state', challenge.value);
  }
  const qrImageUrl = process.env.WECHAT_QR_IMAGE_URL || null;
  const generated = qrAuthUrl ? await generatedQrImage(qrAuthUrl.toString()) : qrImageUrl ? { imageUrl: qrImageUrl, generated: false, error: null } : { imageUrl: null, generated: false, error: null };
  const imageAdapterReady = Boolean(qrImageUrl && process.env.WECHAT_QR_CALLBACK_SECRET);
  return {
    remoteReady: hasToken || hasAppCredentials,
    authorized: hasToken,
    persisted: Boolean(saved?.access_token),
    expiresAt: saved?.expires_at || null,
    qrAuthorization: Boolean(qrAuthUrl || imageAdapterReady),
    qrAuthUrl: qrAuthUrl?.toString() || null,
    qrImageUrl: generated.imageUrl,
    qrGenerated: generated.generated,
    qrError: normalizedQrAuth.error || generated.error || (qrImageUrl && !qrAuthUrl && !imageAdapterReady ? '已有二维码图片模式需配置 WECHAT_QR_CALLBACK_SECRET' : null),
    callbackUrl: process.env.WECHAT_QR_CALLBACK_URL || `http://127.0.0.1:${port}/api/wechat/auth/callback`,
    mode: hasToken || hasAppCredentials ? 'wechat-api' : 'local-bundle',
    message: '授权凭据仅保存在本机 .local-data；下次启动会自动复用。配置授权入口后，二维码由本机自动生成。'
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
    assertLocalRequest(req);
    const raw = decodeURIComponent((req.url || '/').split('?')[0]);
    if (raw === '/api/wechat/status' && req.method === 'GET') return json(res, 200, await wechatStatus());
    if (raw === '/api/wechat/auth/callback' && req.method === 'GET') {
      return json(res, 200, {
        ok: false,
        code: 'AUTH_CALLBACK_ENDPOINT',
        message: '这是授权回调地址，不是二维码展示页。请打开本机首页查看二维码；授权适配器扫码完成后，再通过 POST 回调凭据。',
        homeUrl: `http://127.0.0.1:${port}/`,
        statusUrl: `http://127.0.0.1:${port}/api/wechat/status`,
        callbackMethod: 'POST'
      });
    }
    if (raw === '/api/wechat/auth/callback' && req.method === 'POST') {
      const body = await readJson(req);
      return json(res, 200, await saveAuth(body));
    }
    if (raw === '/api/extract-document' && req.method === 'POST') {
      const filename = requestFilename(req);
      const buffer = await readBuffer(req);
      return json(res, 200, await extractLocalDocument({ buffer, filename, contentType: req.headers['content-type'] }));
    }
    if (raw === '/api/wechat/draft' && req.method === 'POST') { const body = await readJson(req); return json(res, 200, await publishGuiDocument(body.doc, body.confirm === true)); }
    const file = publicFilePath(raw);
    if (!file) throw new Error('not public');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not file');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch (error) {
    if ((req.url || '').startsWith('/api/')) return json(res, error.status || 400, { error: error.message });
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`WeChat Layout MVP: http://127.0.0.1:${port}`);
});
