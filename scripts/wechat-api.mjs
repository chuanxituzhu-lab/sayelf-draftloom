import { readProtectedAuth } from './local-auth.mjs';
import { describeWechatError } from '../src/wechat-response.js';

export function assertWechatApiEndpoint(endpoint) {
  const url = new URL(endpoint);
  const hasUserInfo = Boolean(url.username || url.password);
  const isOfficial = url.protocol === 'https:' && url.hostname === 'api.weixin.qq.com' && !url.port;
  const isLocalAdapter = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (hasUserInfo || (!isOfficial && !isLocalAdapter)) throw new Error('公众号接口地址只允许官方 HTTPS 域名；测试适配器仅可使用本机回环地址');
  return url;
}

export function redactWechatToken(message, token) {
  const text = String(message || '');
  return token ? text.split(String(token)).join('[已隐藏凭据]') : text;
}

export async function resolveWechatAccessToken({ root, env = process.env, fetchImpl = fetch, now = Date.now() } = {}) {
  const configuredToken = env.WECHAT_ACCESS_TOKEN || env.WX_ACCESS_TOKEN;
  if (configuredToken) return configuredToken;
  const saved = root ? readProtectedAuth(root) : null;
  const appId = env.WECHAT_APP_ID || env.WX_APPID;
  const appSecret = env.WECHAT_APP_SECRET || env.WX_APPSECRET;
  const expiresAt = saved?.expires_at ? Date.parse(saved.expires_at) : 0;
  if (saved?.access_token && (!Number.isFinite(expiresAt) || expiresAt > now + 60_000 || !appId || !appSecret)) return saved.access_token;
  if (!appId || !appSecret) return saved?.access_token || null;
  const endpoint = env.WECHAT_TOKEN_API_URL || 'https://api.weixin.qq.com/cgi-bin/token';
  const url = assertWechatApiEndpoint(endpoint);
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', appSecret);
  let response;
  try { response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) }); }
  catch (error) { throw new Error(`获取微信 access_token 失败：无法连接微信接口${error?.cause?.code ? `（网络错误 ${error.cause.code}）` : ''}`); }
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`获取微信 access_token 失败：${describeWechatError(body) || response.status}`);
  return body.access_token;
}

export async function fetchWechatDraftPage({ token, offset = 0, count = 20, fetchImpl = fetch, endpoint = 'https://api.weixin.qq.com/cgi-bin/draft/batchget' }) {
  const url = assertWechatApiEndpoint(endpoint);
  url.searchParams.set('access_token', token);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offset, count: Math.min(20, Math.max(1, Number(count) || 20)), no_content: 0 }),
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) { throw new Error(`读取公众号草稿列表失败：无法连接微信接口${error?.cause?.code ? `（网络错误 ${error.cause.code}）` : ''}`); }
  const body = await response.json();
  if (!response.ok || Number(body.errcode || 0) !== 0) throw new Error(`读取公众号草稿列表失败：${redactWechatToken(describeWechatError(body) || response.status, token)}`);
  return body;
}
