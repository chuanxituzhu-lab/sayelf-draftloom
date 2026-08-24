#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInitialDocument, parseCommand, reduceDocument, stamp, clone, importArticle, getLayoutGuidance, renderArticleHtml } from '../src/core.js';
import { analyzeGrowth, getDefaultGrowthProfile, growthBrief } from '../src/growth.js';
import { draftCoverCopy, renderCoverSvg, auditCoverImage, COVER_SPEC } from '../src/cover.js';
import { WECHAT_LIMITS, inspectWechatArticle, inspectWechatCover, charCount } from '../src/wechat-limits.js';
import { applyProtectedLocalConfig } from './local-config.mjs';

applyProtectedLocalConfig(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const args = process.argv.slice(2);
const command = args.shift();
const option = (name, fallback = undefined) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; };
const optionAll = name => args.reduce((values, value, index) => value === `--${name}` && args[index + 1] ? [...values, args[index + 1]] : values, []);
const dataFile = resolve(option('data', process.env.WECHAT_LAYOUT_DATA || '.local-data/document.json'));
function growthProfile() {
  const inline = option('profile-json');
  if (inline) { try { return JSON.parse(inline); } catch { throw new Error('--profile-json 不是有效 JSON'); } }
  const profilePath = resolve(option('profile', '.local-data/growth-profile.json'));
  try { return JSON.parse(readFileSync(profilePath, 'utf8')); } catch { return getDefaultGrowthProfile(); }
}

async function loadState() {
  if (!existsSync(dataFile)) {
    const doc = createInitialDocument();
    return { doc, selectedId: null, history: [{ seq: 1, ts: doc.meta.updatedAt, label: '初始化', doc: clone(doc) }], future: [] };
  }
  return JSON.parse(await readFile(dataFile, 'utf8'));
}
async function saveState(state) { await mkdir(dirname(dataFile), { recursive: true }); await writeFile(dataFile, JSON.stringify(state, null, 2), 'utf8'); return state; }
function stateFromDocument(doc) { return { doc, selectedId: doc.blocks[0]?.id || null, history: [{ seq: 1, ts: doc.meta.updatedAt, label: '导入文章', doc: clone(doc) }], future: [] }; }
async function applyIntent(intent, label) {
  const state = await loadState();
  const result = reduceDocument(state.doc, intent, state.selectedId);
  if (result.error) return { ...state, error: result.error, changed: false };
  let finalResult = result;
  if (result.changed && intent.type !== 'optimizeWechat') {
    const automatic = reduceDocument(result.doc, { type: 'optimizeWechat' }, result.selectedId);
    if (automatic.changed) finalResult = { ...result, doc: automatic.doc, selectedId: automatic.selectedId, optimization: automatic.optimization, autoOptimized: true };
  }
  if (!finalResult.changed) return { ...state, error: null, changed: false };
  const next = stamp(clone(finalResult.doc), state.doc.meta.revision + 1);
  state.doc = next; state.selectedId = finalResult.selectedId;
  const historyLabel = finalResult.autoOptimized ? `${label}（自动微信约束优化）` : label;
  state.history = [...(state.history || []), { seq: next.meta.revision, ts: next.meta.updatedAt, label: historyLabel, doc: clone(next) }].slice(-50); state.future = [];
  await saveState(state); return { ...state, changed: true, optimization: finalResult.optimization || null };
}
async function optimizeStateForWechat(state) {
  const result = reduceDocument(state.doc, { type: 'optimizeWechat' }, state.selectedId);
  if (!result.changed) return result.optimization;
  const next = stamp(clone(result.doc), state.doc.meta.revision + 1);
  state.doc = next;
  state.selectedId = result.selectedId;
  state.history = [...(state.history || []), { seq: next.meta.revision, ts: next.meta.updatedAt, label: '提交前智能优化微信发布约束', doc: clone(next) }].slice(-50);
  state.future = [];
  await saveState(state);
  return result.optimization;}
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
async function assetFromFile(filePath) {
  const data = await readFile(filePath);
  const type = imageTypes[extname(filePath).toLowerCase()] || 'application/octet-stream';
  return { name: basename(filePath), type, size: data.length, dataUrl: `data:${type};base64,${data.toString('base64')}`, alt: basename(filePath, extname(filePath)) };
}
async function importCoverIntoState() {
  const imagePath = option('image', option('file'));
  if (!imagePath) throw new Error('请提供 --image <封面图片路径>');
  const resolvedImage = resolve(imagePath);
  const asset = await assetFromFile(resolvedImage);
  if (!WECHAT_LIMITS.titleImage.acceptedTypes.includes(asset.type)) throw new Error(`微信公众号封面暂不支持 ${asset.type}，请使用 PNG/JPG/JPEG`);
  asset.id = crypto.randomUUID();
  asset.width = Number(option('width', 900));
  asset.height = Number(option('height', 383));
  asset.alt = option('alt', `${basename(resolvedImage, extname(resolvedImage))} 公众号封面`);
  asset.coverMain = option('main', '别忽略微信预览');
  asset.coverSub = option('sub', '右侧实时查看的价值');
  asset.visualRole = 'cover';
  asset.generated = true;
  asset.source = option('source', 'imagegen:local');
  asset.prompt = option('prompt', '根据文章内容生成公众号头条封面：编辑工作区与右侧实时微信预览，左侧留白用于标题叠加');
  asset.createdAt = new Date().toISOString();
  const added = await applyIntent({ type: 'addAsset', asset }, '导入公众号封面素材');
  if (!added.changed) throw new Error(added.error || '封面素材导入失败');
  const composed = await applyIntent({ type: 'setCoverAsset', assetId: asset.id }, '设置为公众号头条封面');
  if (!composed.changed) throw new Error(composed.error || '封面素材设置失败');
  const state = await loadState();
  const coverBlock = state.doc.blocks.find(block => block.type === 'image' && block.visualRole === 'cover');
  const coverAsset = coverBlock ? state.doc.assets.find(item => item.id === coverBlock.assetId) : null;
  return {
    changed: true,
    revision: state.doc.meta.revision,
    cover: {
      assetId: coverAsset?.id || null,
      name: coverAsset?.name || null,
      width: coverAsset?.width || null,
      height: coverAsset?.height || null,
      bytes: coverAsset?.size || null,
      main: coverAsset?.coverMain || null,
      sub: coverAsset?.coverSub || null
    },
    message: '封面已写入本地素材库并替换当前公众号头条封面'
  };
}
async function collectImagePaths() {
  const paths = [...optionAll('image')];
  const folder = option('images');
  if (folder && existsSync(resolve(folder))) {
    const entries = await readdir(resolve(folder), { withFileTypes: true });
    paths.push(...entries.filter(entry => entry.isFile() && imageTypes[extname(entry.name).toLowerCase()]).map(entry => join(resolve(folder), entry.name)));
  }
  return [...new Set(paths.map(path => resolve(path)))];
}
async function importFromInput() {
  const articlePath = option('article', option('file'));
  const inlineText = option('text');
  if (!articlePath && inlineText === undefined) throw new Error('请提供 --article <文章文件> 或 --text <文章内容>');
  const text = inlineText !== undefined ? inlineText : await readFile(resolve(articlePath), 'utf8');
  const assets = await Promise.all((await collectImagePaths()).map(assetFromFile));
  const doc = importArticle({ text, filename: articlePath ? basename(articlePath) : 'pasted-article.txt', assets, autoCompose: true, visualOptions: { generate: true, maxGenerated: Number(option('max-generated', 3)), titleMode: 'viral', forceTitle: true } });
  const state = stateFromDocument(doc);
  const automatic = reduceDocument(state.doc, { type: 'optimizeWechat' }, state.selectedId);
  if (automatic.changed) {
    const next = stamp(clone(automatic.doc), state.doc.meta.revision + 1);
    state.doc = next;
    state.history.push({ seq: next.meta.revision, ts: next.meta.updatedAt, label: '导入文章（自动微信约束优化）', doc: clone(next) });
  }
  await saveState(state);
  return { ...state, guidance: getLayoutGuidance(state.doc), warnings: state.doc.meta.importWarnings || [] };
}
function renderHtml(doc) { return renderArticleHtml(doc); }
function dataUrlParts(dataUrl = '') {
  const match = String(dataUrl).match(/^data:([^;]+);base64,([\s\S]+)$/);
  return match ? { type: match[1], bytes: Buffer.from(match[2], 'base64') } : null;
}
function readPersistedAuth() {
  try {
    const saved = JSON.parse(readFileSync(resolve('.local-data/wechat-auth.json'), 'utf8'));
    return saved?.access_token && (!saved.expires_at || Date.parse(saved.expires_at) > Date.now() + 30_000) ? saved : null;
  } catch { return null; }
}
async function resolveWechatAccessToken() {
  if (process.env.WECHAT_ACCESS_TOKEN || process.env.WX_ACCESS_TOKEN) return process.env.WECHAT_ACCESS_TOKEN || process.env.WX_ACCESS_TOKEN;
  const saved = readPersistedAuth();
  if (saved) return saved.access_token;
  const appId = process.env.WECHAT_APP_ID || process.env.WX_APPID;
  const appSecret = process.env.WECHAT_APP_SECRET || process.env.WX_APPSECRET;
  if (!appId || !appSecret) return null;
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(`获取微信 access_token 失败：${describeWechatError(body) || response.status}`);
  return body.access_token;
}
function wechatDraftStatus() {
  const persisted = Boolean(readPersistedAuth());
  const hasToken = Boolean(process.env.WECHAT_ACCESS_TOKEN || process.env.WX_ACCESS_TOKEN) || persisted;
  const hasAppCredentials = Boolean((process.env.WECHAT_APP_ID || process.env.WX_APPID) && (process.env.WECHAT_APP_SECRET || process.env.WX_APPSECRET));
  const qrAuthUrl = process.env.WECHAT_QR_AUTH_URL || null;
  const qrImageUrl = process.env.WECHAT_QR_IMAGE_URL || null;
  return { remoteReady: hasToken || hasAppCredentials, authorized: hasToken, persisted, qrAuthorization: Boolean(qrAuthUrl || qrImageUrl), qrAuthUrl, qrImageUrl, mode: hasToken || hasAppCredentials ? 'wechat-api' : 'local-bundle', message: '授权凭据保存在本机 .local-data；二维码由授权适配器提供。' };
}
function describeWechatError(body = {}) {
  const map = {
    40001: 'access_token 无效或过期，请检查 AppID/AppSecret',
    40007: 'media_id 无效，封面素材可能已失效',
    40009: '图片超出大小限制（≤10MB）',
    40164: '调用 IP 不在公众号白名单，请在「设置与开发→基本配置→IP 白名单」加入微信错误消息中的公网 IP',    41001: '缺少 access_token 参数',
    45009: '接口调用频次超限',
    45166: '内容含敏感词或非法 HTML 标签，请检查正文',
    48001: '接口未授权，需认证公众号并开通草稿箱权限',
    53404: '账号已被限制，无法新建草稿'
  };
  if (body.errcode && map[body.errcode]) return `[${body.errcode}] ${map[body.errcode]}`;
  if (body.errmsg) return `[${body.errcode || '?'}] ${body.errmsg}`;
  return '';
}
const FORBIDDEN_ENDPOINTS = ['freepublish/submit', 'message/mass', 'message/masssend'];
function assertDraftOnly(endpoint) {
  const hit = FORBIDDEN_ENDPOINTS.find(fragment => endpoint.includes(fragment));
  if (hit) throw new Error(`安全红线：检测到发布/群发端点「${hit}」，本工具只允许写入草稿箱，拒绝执行`);
}
function assertWechatContentLimits(html) {
  const result = inspectWechatArticle({ content: html });
  const error = result.errors.find(item => item.id === 'contentChars' || item.id === 'contentBytes');
  if (error) throw new Error(error.message);
}
async function uploadWechatArticleImage(asset, token) {
  const parts = dataUrlParts(asset.dataUrl);
  if (!parts) throw new Error(`图片 ${asset.name} 不是可上传的本地 Data URL`);
  if (!['image/png', 'image/jpeg', 'image/jpg', 'image/gif'].includes(parts.type)) throw new Error(`微信图文图片暂不支持 ${parts.type}：${asset.name}`);
  if (parts.bytes.length > WECHAT_LIMITS.imageBytes) throw new Error(`微信正文图片超 10MB：${asset.name}`);
  const form = new FormData();
  form.append('media', new Blob([parts.bytes], { type: parts.type }), asset.name);
  const endpoint = process.env.WECHAT_IMAGE_UPLOAD_URL || 'https://api.weixin.qq.com/cgi-bin/media/uploadimg';
  const joiner = endpoint.includes('?') ? '&' : '?';
  const response = await fetch(`${endpoint}${joiner}access_token=${encodeURIComponent(token)}`, { method: 'POST', body: form });
  const body = await response.json();
  if (!response.ok || !body.url) throw new Error(`上传微信图文图片失败：${describeWechatError(body) || response.status}`);
  return body.url;
}
async function uploadWechatCover(asset, token) {
  const parts = dataUrlParts(asset?.dataUrl);
  if (!parts) throw new Error(`封面 ${asset?.name || '未命名'} 不是可上传的本地 Data URL`);
  if (!WECHAT_LIMITS.titleImage.acceptedTypes.includes(parts.type)) throw new Error(`微信封面暂不支持 ${parts.type}：${asset.name}`);
  if (parts.bytes.length > WECHAT_LIMITS.imageBytes) throw new Error(`微信封面超 10MB（微信错误码 40009）：${asset.name}`);
  const form = new FormData();
  form.append('media', new Blob([parts.bytes], { type: parts.type }), asset.name || 'cover.jpg');
  const endpoint = process.env.WECHAT_COVER_UPLOAD_URL || 'https://api.weixin.qq.com/cgi-bin/material/add_material';
  const joiner = endpoint.includes('?') ? '&' : '?';
  const response = await fetch(`${endpoint}${joiner}type=image&access_token=${encodeURIComponent(token)}`, { method: 'POST', body: form });
  const body = await response.json();
  if (!response.ok || !body.media_id || Number(body.errcode || 0) !== 0) throw new Error(`上传微信封面失败：${describeWechatError(body) || response.status}`);
  return body.media_id;
}
async function publishFromState({ allowRemote = false } = {}) {
  const state = await loadState();
  const optimization = await optimizeStateForWechat(state);  const out = resolve(option('out', join('.local-data', 'publish', `revision-${state.doc.meta.revision}`)));
  await mkdir(out, { recursive: true });
  const htmlPath = join(out, 'article.html');
  const payloadPath = join(out, 'draft-payload.json');
  const manifestPath = join(out, 'publish-manifest.json');
  let renderDoc = state.doc;
  let html = renderHtml(renderDoc);
  const title = state.doc.title || '';
  if (charCount(title) > WECHAT_LIMITS.titleChars) throw new Error(`标题超 ${WECHAT_LIMITS.titleChars} 字（微信 draft/add 上限），当前 ${charCount(title)} 字，请精简`);
  const author = option('author', state.doc.author || '');
  if (charCount(author) > WECHAT_LIMITS.authorChars) throw new Error(`作者名超 ${WECHAT_LIMITS.authorChars} 字（微信 draft/add 上限），当前 ${charCount(author)} 字`);
  let digest = option('digest', state.doc.subtitle || '');
  if (charCount(digest) > WECHAT_LIMITS.digestChars) throw new Error(`摘要超 ${WECHAT_LIMITS.digestChars} 字（微信 draft/add 上限），当前 ${charCount(digest)} 字，请精简`);
  const payload = {
    article_type: 'news',    title,
    author,
    digest,
    content: html,
    content_source_url: option('source', '')
  };
  let draftValidation = inspectWechatArticle({ ...payload, contentSourceUrl: payload.content_source_url });
  if (!draftValidation.ok) throw new Error(draftValidation.errors[0].message);
  const endpoint = allowRemote ? option('api-url', process.env.WECHAT_DRAFT_API_URL || ((process.env.WECHAT_ACCESS_TOKEN || process.env.WX_ACCESS_TOKEN || readPersistedAuth()?.access_token || ((process.env.WECHAT_APP_ID || process.env.WX_APPID) && (process.env.WECHAT_APP_SECRET || process.env.WX_APPSECRET))) ? 'https://api.weixin.qq.com/cgi-bin/draft/add' : undefined)) : undefined;
  if (endpoint) assertDraftOnly(endpoint);
  const token = endpoint ? await resolveWechatAccessToken() : null;
  let delivery = { mode: 'local-bundle', status: 'ready' };
  let coverValidation = null;
  if (endpoint && token) {
    const officialApi = endpoint.includes('api.weixin.qq.com');
    let thumbMediaId = option('cover-media-id', process.env.WECHAT_COVER_MEDIA_ID || null);
    if (officialApi && !thumbMediaId) {
      const coverBlock = renderDoc.blocks.find(block => block.type === 'image' && renderDoc.assets.some(asset => asset.id === block.assetId));
      const coverAsset = coverBlock ? renderDoc.assets.find(asset => asset.id === coverBlock.assetId) : null;
      if (!coverAsset) throw new Error('微信公众号草稿需要封面图：请在文章中插入图片，或设置 WECHAT_COVER_MEDIA_ID');
      coverValidation = inspectWechatCover({ width: coverAsset.width, height: coverAsset.height, bytes: coverAsset.size, type: coverAsset.type, main: coverAsset.coverMain || '', sub: coverAsset.coverSub || '' });
      if (coverValidation.errors.length) throw new Error(`标题图片不符合微信限制：${coverValidation.errors[0]}`);
      thumbMediaId = await uploadWechatCover(coverAsset, token);
    }
    if (officialApi && renderDoc.blocks.some(block => block.type === 'image' || block.type === 'gallery')) {
      renderDoc = clone(state.doc);
      for (const asset of renderDoc.assets) {
        if (!renderDoc.blocks.some(block => block.assetId === asset.id || (block.assetIds || []).includes(asset.id))) continue;
        asset.dataUrl = await uploadWechatArticleImage(asset, token);
      }
      html = renderHtml(renderDoc);
      // 图片先换成微信 URL，再检查正文大小，避免把本地图片 Base64 误算进正文长度。
      assertWechatContentLimits(html);
    }
    if (officialApi && !renderDoc.blocks.some(block => block.type === 'image' || block.type === 'gallery')) assertWechatContentLimits(html);
    payload.content = html;
    draftValidation = inspectWechatArticle({ ...payload, contentSourceUrl: payload.content_source_url });
    if (!draftValidation.ok) throw new Error(draftValidation.errors[0].message);
    if (thumbMediaId) payload.thumb_media_id = thumbMediaId;
    await writeFile(htmlPath, html, 'utf8');
    await writeFile(payloadPath, JSON.stringify({ articles: [payload] }, null, 2), 'utf8');
    const joiner = endpoint.includes('?') ? '&' : '?';
    const response = await fetch(`${endpoint}${joiner}access_token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ articles: [payload] }) });
    const responseText = await response.text();
    let parsedResponse = null; try { parsedResponse = JSON.parse(responseText); } catch {}
    const apiFailed = !response.ok || (parsedResponse && Number(parsedResponse.errcode || 0) !== 0);
    const draftId = parsedResponse?.media_id || parsedResponse?.draft_id || null;
    delivery = {
      mode: 'wechat-api',
      status: apiFailed ? 'failed' : 'submitted',
      httpStatus: response.status,
      draftId,
      draft_media_id: draftId,
      backend_url: 'https://mp.weixin.qq.com/ （登录后进入「草稿箱」查看）',
      reviewRequired: !apiFailed,
      nextAction: apiFailed ? null : '请在微信公众号后台人工审核后发送',
      error: apiFailed ? describeWechatError(parsedResponse || {}) : null,
      response: responseText.slice(0, 500)
    };
    if (apiFailed) throw new Error(`微信草稿接口失败：${describeWechatError(parsedResponse || {}) || response.status}`);
  } else if (endpoint && !token) {
    delivery = { mode: 'local-bundle', status: 'ready', warning: '已生成草稿包；未检测到 WECHAT_ACCESS_TOKEN，未调用远程接口' };
  }  await writeFile(htmlPath, html, 'utf8');
  await writeFile(payloadPath, JSON.stringify({ articles: [payload] }, null, 2), 'utf8');
  const manifest = {
    generatedAt: new Date().toISOString(),
    revision: state.doc.meta.revision,
    theme: state.doc.theme || 'minimal',
    stage: delivery.status === 'submitted' ? '③已进草稿箱（待人工审核+人工发布）' : '③本地包',
    wechatLimits: { ...draftValidation, cover: coverValidation },
    htmlPath,
    payloadPath,
    delivery,
    optimization: optimization ? { changes: optimization.changes, remaining: optimization.validation?.errors?.map(item => item.message) || [], distilled: optimization.distillation, seriesPlan: optimization.seriesPlan } : null,    manual_next_steps: [
      '1. 登录 mp.weixin.qq.com → 草稿箱，人工核对排版/图片/错字',
      '2. 确认无误后在后台手动「群发」或「发布」（本工具不代发）'
    ]
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}
const output = value => console.log(JSON.stringify(value, null, 2));
try {
  if (command === 'init') output(await saveState(await loadState()));
  else if (command === 'state') output(await loadState());
  else if (command === 'import') output(await importFromInput());
  else if (command === 'guidance') { const state = await loadState(); output({ guidance: getLayoutGuidance(state.doc), warnings: state.doc.meta.importWarnings || [] }); }
  else if (command === 'growth') { const state = await loadState(); output(analyzeGrowth(state.doc, growthProfile())); }
  else if (command === 'growth-brief') { const state = await loadState(); output(growthBrief(state.doc, growthProfile())); }
  else if (command === 'wechat-optimize' || command === 'optimize-wechat') output(await applyIntent({ type: 'optimizeWechat' }, '智能优化微信发布约束'));
  else if (command === 'wechat-check' || command === 'check-wechat') {
    const before = await loadState();
    const optimization = await optimizeStateForWechat(before);
    const state = await loadState();
    const payload = { title: state.doc.title, author: state.doc.author || '', digest: state.doc.subtitle || '', content: renderHtml(state.doc) };
    const article = inspectWechatArticle(payload);
    const coverBlock = state.doc.blocks.find(block => block.type === 'image');
    const coverAsset = coverBlock ? state.doc.assets.find(asset => asset.id === coverBlock.assetId) : null;
    const cover = coverAsset ? inspectWechatCover({ width: coverAsset.width, height: coverAsset.height, bytes: coverAsset.size, type: coverAsset.type, main: coverAsset.coverMain || '', sub: coverAsset.coverSub || '' }) : null;
    const errors = [...article.errors, ...(cover?.errors || []).map(message => ({ id: 'titleImage', message }))];
    output({ changed: Boolean(optimization?.changes?.length), optimization, validation: { ...article, cover, errors, ok: article.ok && Boolean(cover) && !cover?.errors?.length }, guidance: getLayoutGuidance(state.doc), warnings: state.doc.meta.importWarnings || [] });
  }
  else if (command === 'draft-status') output(wechatDraftStatus());
  else if (command === 'text') output(await applyIntent(parseCommand(option('text', args.join(' '))), '文字指令'));
  else if (command === 'humanize') output(await applyIntent({ type: 'humanize', mode: option('mode', 'natural') === 'conservative' ? 'conservative' : 'natural' }, '去 AI 味'));
  else if (command === 'visuals' || command === 'compose' || command === 'viral-title' || command === 'assets-fill' || command === 'fill-assets') output(await applyIntent({ type: 'autoComposeVisuals', generate: !['viral-title', 'assets-fill', 'fill-assets'].includes(command) && option('generate', 'true') !== 'false', maxGenerated: ['viral-title', 'assets-fill', 'fill-assets'].includes(command) ? 0 : Number(option('max-generated', 3)), titleMode: command === 'viral-title' ? 'viral' : 'safe', forceTitle: command === 'viral-title' || option('force-title', 'false') === 'true', fillUnmatched: ['assets-fill', 'fill-assets'].includes(command) }, command === 'viral-title' ? '生成爆款标题' : ['assets-fill', 'fill-assets'].includes(command) ? '图片智能导入' : '智能配图与标题'));
  else if (command === 'cover-set' || command === 'smart-cover') output(await applyIntent({ type: 'smartCover' }, '封面一键设置'));
  else if (command === 'intent') output(await applyIntent(JSON.parse(option('json', '{}')), '结构化指令'));
  else if (command === 'export') { const state = await loadState(); const out = resolve(option('out', `wechat-layout-${state.doc.meta.revision}.html`)); await writeFile(out, renderHtml(state.doc), 'utf8'); output({ out, revision: state.doc.meta.revision }); }
  else if (command === 'cover-import' || command === 'import-cover') output(await importCoverIntoState());
  else if (command === 'cover') {
    const state = await loadState();
    const title = option('title', state.doc.title || '');
    const bodyText = (state.doc.blocks || []).map(block => block.text || '').join(' ');    const copy = draftCoverCopy({ title, body: bodyText, formula: option('formula', null) });
    const chosen = copy.candidates[0] || { main: title, sub: '' };
    const out = resolve(option('out', join('.local-data', 'cover')));
    await mkdir(out, { recursive: true });
    const headlineSvg = renderCoverSvg({
      main: option('main', chosen.main),
      sub: option('sub', chosen.sub),
      kind: 'headline',
      bg: option('bg', '#0f172a'),
      fg: option('fg', '#ffffff'),
      accent: option('accent', '#22c55e')
    });
    const squareSvg = renderCoverSvg({
      main: option('main', chosen.main),
      sub: '',
      kind: 'square',
      bg: option('bg', '#0f172a'),
      fg: option('fg', '#ffffff'),
      accent: option('accent', '#22c55e')
    });    const headlinePath = join(out, 'cover-900x383.svg');
    const squarePath = join(out, 'cover-383x383.svg');
    await writeFile(headlinePath, headlineSvg, 'utf8');
    await writeFile(squarePath, squareSvg, 'utf8');
    // 若指定了自带封面图，做尺寸/大小规范体检
    let audit = null;
    const existing = option('audit');
    if (existing) {
      const parts = dataUrlParts((await assetFromFile(resolve(existing))).dataUrl);
      audit = {
        note: '像素尺寸需在图片软件查看后用 --width/--height 传入；此处只据文件大小体检',
        bytes: parts ? parts.bytes.length : 0,
        ...auditCoverImage({ width: Number(option('width', 0)), height: Number(option('height', 0)), bytes: parts ? parts.bytes.length : 0 })
      };
    }
    output({
      spec: COVER_SPEC,
      headlineSvg: headlinePath,
      squareSvg: squarePath,
      copyCandidates: copy.candidates,
      copyChecks: copy.checks,
      signals: copy.signals,
      audit,
      manual_next: '请人工挑选/微调封面文案；如需提交微信草稿箱，使用 --cover 指定最终封面图片'
    });
  }
  else if (command === 'publish') output(await publishFromState());
  else if (command === 'draft-submit') { if (option('confirm') !== 'true') throw new Error('提交草稿箱前必须显式传入 --confirm true'); output(await publishFromState({ allowRemote: true })); }
  else console.log('公众号排版 CLI\n\ninit\nimport --article article.md --images ./images\nimport --text "文章内容" --image cover.png\nvisuals --max-generated 3\ncover-set\ncover-import --image assets/covers/cover.jpg --width 900 --height 383\nviral-title\nassets-fill\nwechat-check\nwechat-optimize\nguidance\ngrowth [--profile .local-data/growth-profile.json]\ngrowth-brief [--profile .local-data/growth-profile.json]\nstate\ndraft-status\ndraft-submit --confirm true\ntext --text "标题：文章标题"\nhumanize --mode natural\nintent --json \'{"type":"appendBlock","blockType":"paragraph","text":"正文"}\'\nexport --out article.html\npublish --out .local-data/publish/revision-1');} catch (error) { console.error(error.message); process.exitCode = 1; }
