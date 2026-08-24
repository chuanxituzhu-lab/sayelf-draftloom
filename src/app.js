import { createInitialDocument, parseCommand, reduceDocument, VersionStore, importArticle, getLayoutGuidance, THEMES, normalizeTheme, renderDocumentBody, renderArticleHtml } from './core.js';
import { analyzeGrowth, getDefaultGrowthProfile, growthBrief, normalizeGrowthProfile } from './growth.js';
import { WECHAT_LIMITS, inspectWechatArticle, inspectWechatCover, formatBytes } from './wechat-limits.js';
import { APP_VERSION } from './version.js';

const STORAGE_KEY = 'wechat-layout-mvp:v0.1';
const ASSET_LIBRARY_KEY = 'wechat-layout-mvp:asset-library:v0.1';
const GROWTH_PROFILE_KEY = 'wechat-layout-mvp:growth-profile:v0.1';
const MAX_ASSETS = 200;
let doc = loadDocument() || { ...createInitialDocument(), assets: loadAssetLibrary() };
let selectedId = doc.blocks[0]?.id || null;
let zoom = 1;
let store = new VersionStore(doc);
let status = '就绪';
let libraryTab = 'mine';
let assetQuery = '';
let assetSort = 'recent';
let assetFilter = 'all';
let authPollTimer = null;
let autoSubmitAfterAuth = false;
let growthProfile = loadGrowthProfile();
let growthReport = null;
let lastWechatCheck = null;

function loadDocument() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return null;
    saved.assets = mergeAssets(saved.assets || [], loadAssetLibrary());
    return saved;
  } catch { return null; }
}
function loadAssetLibrary() {
  try {
    const value = JSON.parse(localStorage.getItem(ASSET_LIBRARY_KEY) || '[]');
    return Array.isArray(value) ? value.filter(asset => asset?.id && asset?.dataUrl).slice(-MAX_ASSETS) : [];
  } catch { return []; }
}
function mergeAssets(...lists) {
  const byId = new Map();
  for (const list of lists) for (const asset of Array.isArray(list) ? list : []) if (asset?.id && asset?.dataUrl) byId.set(asset.id, asset);
  return [...byId.values()].slice(-MAX_ASSETS);
}
function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  // 文档状态是素材库的唯一持久化事实源，避免已删除素材被旧缓存重新合并回来。
  localStorage.setItem(ASSET_LIBRARY_KEY, JSON.stringify(doc.assets || []));
}
function esc(s='') { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function assetById(id) { return doc.assets.find(a => a.id === id); }
function currentCoverBlock() { return doc.blocks.find(block => block.type === 'image' && block.visualRole === 'cover') || doc.blocks.find(block => block.type === 'image') || null; }
function currentCoverAsset() { const block = currentCoverBlock(); return block ? assetById(block.assetId) : null; }
function setStatus(text) { status = text; renderStatus(); }
function renderStatus() {
  const el = document.querySelector('#statusText');
  if (el) el.textContent = status;
  const rev = document.querySelector('#revisionText');
  if (rev) rev.textContent = `v${doc.meta.revision} · ${new Date(doc.meta.updatedAt).toLocaleTimeString()}`;
}
function loadGrowthProfile() {
  try { return normalizeGrowthProfile(JSON.parse(localStorage.getItem(GROWTH_PROFILE_KEY) || '{}')); } catch { return getDefaultGrowthProfile(); }
}
function saveGrowthProfile() { localStorage.setItem(GROWTH_PROFILE_KEY, JSON.stringify(growthProfile)); }
function assetInUse(assetId) {
  return doc.blocks.some(block => block.assetId === assetId || (block.assetIds || []).includes(assetId));
}
function renderLibraryPane() {
  const tabs = [['mine', '我的素材'], ['resource', '资源库'], ['script', '文字稿']].map(([id, label]) => `<button class="library-tab ${libraryTab === id ? 'active' : ''}" data-library-tab="${id}">${label}</button>`).join('');
  if (libraryTab === 'script') {
    const source = doc.original?.text || doc.blocks.filter(block => block.type !== 'image').map(block => block.text || '').join('\n\n');
    return `<div class="library-header"><div class="library-tabs">${tabs}</div><div class="script-tools"><span>原稿文字（只读保护）</span><button data-copy-script>复制</button></div></div><textarea class="script-view" readonly>${esc(source)}</textarea>`;
  }
  const query = assetQuery.trim().toLowerCase();
  let assets = doc.assets.filter(asset => (!query || `${asset.name} ${asset.alt || ''}`.toLowerCase().includes(query)) && (assetFilter !== 'unused' || !assetInUse(asset.id)));
  if (assetSort === 'name') assets = [...assets].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const scopeLabel = libraryTab === 'resource' ? '本地资源库 · 可跨文章复用' : '先上传，后续可反复插入或替换';
  const cards = assets.length ? assets.map(a => `<div class="asset-card" data-asset-card="${a.id}"><img src="${a.dataUrl}" alt="${esc(a.alt||a.name)}"><span title="${esc(a.name)}">${esc(a.name)}</span><small>${a.recognition?.labels?.length ? `识别：${esc(a.recognition.labels.slice(0, 2).join(' · '))}` : a.generated ? (assetInUse(a.id) ? '自动生成 · 删除会同步移除' : '自动生成 · 可替换') : assetInUse(a.id) ? '文章使用中 · 删除会同步移除' : '已入库 · 可删除'}</small><div class="asset-actions"><button data-asset-insert="${a.id}" title="在文章末尾插入">插入</button><button data-asset-replace="${a.id}" title="替换当前选中的图片">替换当前</button><button data-asset-delete="${a.id}" title="删除素材及文章中的图片">删除</button></div></div>`).join('') : `<div class="empty library-empty">${query ? '没有匹配的素材' : '暂无素材，可点击“上传素材”添加'}</div>`;
  return `<div class="library-header"><div class="library-tabs">${tabs}</div><div class="library-toolbar"><input id="assetSearch" value="${esc(assetQuery)}" placeholder="搜索素材"><button data-library-sort title="${assetSort === 'name' ? '恢复最近添加排序' : '按名称排序'}">↕</button><button data-library-filter class="${assetFilter === 'unused' ? 'active' : ''}" title="只看未使用素材">⌁</button></div><div class="library-meta"><span>${scopeLabel}</span><span>${doc.assets.length}/${MAX_ASSETS}</span><label class="mini-button">+ 上传素材<input id="assetInput" type="file" accept="image/*" multiple hidden></label></div></div><div class="asset-grid">${cards}</div><div class="library-footer"><span>支持批量上传 · 大图自动压缩</span><button data-clear-unused>清理未使用</button></div>`;
}
function refreshLibraryPane() {
  const pane = document.querySelector('#libraryPane');
  if (!pane) return;
  pane.innerHTML = renderLibraryPane();
  bindLibraryEvents();
}

function growthBriefText(brief) {
  return [
    `公众号：${brief.account}`,
    `创作方向：${brief.creativeDirection}`,
    `标题建议：${brief.titleSuggestions.join('；')}`,
    `开场建议：${brief.openingSuggestion}`,
    `结构：${brief.outline.join('；')}`,
    `CTA：${brief.ctaSuggestion}`,
    `编辑要求：${brief.editorInstructions.join('；')}`
  ].join('\n');
}

function renderTitlePlan() {
  const plan = doc.meta?.titlePlan;
  if (!plan?.candidates?.length) return '<div class="title-ai-empty">导入文章或点击“智能配图与标题”，自动总结内容并生成爆款标题候选。</div>';
  const candidates = plan.candidates.map((item, index) => `<button type="button" class="title-candidate ${item.title === doc.title ? 'active' : ''}" data-title-candidate="${esc(item.title)}"><b>${index + 1}</b><span>${esc(item.title)}</span><small>${esc(item.rationale || '内容钩子')}</small></button>`).join('');
  return `<div class="title-ai-summary"><b>标题分析摘要（参考）</b><span>${esc(plan.summary || '')}</span></div><div class="title-ai-candidates">${candidates}</div><small class="title-ai-note">${esc(plan.note || '标题仅基于文章内容生成，发布前请人工核对。')}</small>`;
}

function renderCoverSummaryPanel() {
  const cover = currentCoverAsset();
  const imageAssets = doc.assets.filter(asset => asset?.dataUrl && WECHAT_LIMITS.titleImage.acceptedTypes.includes(String(asset.type || '').toLowerCase()));
  const coverCheck = cover ? inspectWechatCover({ width: cover.width, height: cover.height, bytes: cover.size, type: cover.type, main: cover.coverMain || doc.title || '', sub: cover.coverSub || doc.subtitle || '' }) : null;
  const coverOptions = imageAssets.length
    ? imageAssets.map(asset => `<option value="${esc(asset.id)}" ${cover?.id === asset.id ? 'selected' : ''}>${esc(asset.name)}</option>`).join('')
    : '<option value="">素材库暂无图片</option>';
  const statusText = cover
    ? `${coverCheck?.fields.width || 0}×${coverCheck?.fields.height || 0} · 主文案 ${(coverCheck?.fields.mainChars || 0)}/${WECHAT_LIMITS.titleImage.mainChars} · 副文案 ${(coverCheck?.fields.subChars || 0)}/${WECHAT_LIMITS.titleImage.subChars}`
    : '尚未设置封面；公众号草稿必须有头条封面图';
  return `<section class="cover-summary-panel"><div class="cover-summary-head"><div><h3>公众号封面与内容摘要</h3><span>独立设置区 · 按公众号字段 1:1 复刻并同步右侧预览</span></div><button id="coverAutoBtn" type="button" class="primary-button" title="优先复用素材库封面；缺少合规封面时生成可替换候选，并同步封面文案与内容摘要">封面一键设置</button></div><div class="cover-summary-grid"><div class="cover-slot">${cover?.dataUrl ? `<img src="${cover.dataUrl}" alt="${esc(cover.alt || '公众号封面')}">` : '<div class="cover-slot-empty">封面图片<br>900×383</div>'}<span>头条封面 · 900×383</span></div><div class="cover-summary-fields"><label>封面素材<select id="coverAssetSelect">${coverOptions}</select></label><div class="cover-copy-row"><label>封面主文案<input id="coverMainInput" maxlength="${WECHAT_LIMITS.titleImage.mainChars}" value="${esc(cover?.coverMain || doc.title || '')}" placeholder="最多 10 字"></label><label>封面副文案<input id="coverSubInput" maxlength="${WECHAT_LIMITS.titleImage.subChars}" value="${esc(cover?.coverSub || doc.subtitle || '')}" placeholder="最多 14 字"></label></div><label>内容摘要<textarea id="subtitleInput" maxlength="${WECHAT_LIMITS.digestChars}" rows="2" placeholder="最多 128 字">${esc(doc.subtitle || '')}</textarea></label><div class="cover-summary-meta"><span>${esc(statusText)}</span><span>摘要 ${(doc.subtitle || '').length}/${WECHAT_LIMITS.digestChars} 字</span></div></div></div></section>`;
}

function renderGrowthPanel() {
  const report = growthReport;
  const score = report ? `<div class="growth-score"><b>${report.viral.score}</b><span>/100 · ${report.viral.tier === 'strong' ? '强' : report.viral.tier === 'promising' ? '可提升' : '需优化'}</span><em>${report.compliance.decision}</em></div>` : '<div class="growth-empty">填写公众号画像后，分析当前文章并生成创作建议。</div>';
  const suggestions = report?.viral?.suggestions?.length ? `<ul>${report.viral.suggestions.slice(0, 4).map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '';
  return `<section class="growth-section"><div class="section-head"><h3>公众号创作画像</h3><span class="hint">PingPong Growth</span></div><div class="growth-form"><input id="growthAccount" value="${esc(growthProfile.accountName)}" placeholder="公众号名称"><input id="growthPositioning" value="${esc(growthProfile.positioning)}" placeholder="定位 / 内容方向"><input id="growthAudience" value="${esc(growthProfile.audience)}" placeholder="目标读者"><input id="growthTone" value="${esc(growthProfile.tone)}" placeholder="语气风格"><input id="growthKeywords" value="${esc(growthProfile.targetKeywords.join('、'))}" placeholder="关键词，用顿号分隔"><input id="growthCta" value="${esc(growthProfile.cta)}" placeholder="结尾互动引导"><button id="growthAnalyze" class="primary-button">分析并生成创作建议</button></div><div class="growth-result">${score}${suggestions}<button id="growthCopyBrief" ${report ? '' : 'disabled'}>复制创作简报</button></div></section>`;
}

function commit(intent, label) {
  const result = reduceDocument(doc, intent, selectedId);
  if (result.error) { setStatus(result.error); return false; }
  let finalResult = result;
  if (result.changed && intent.type !== 'optimizeWechat') {
    const automatic = reduceDocument(result.doc, { type: 'optimizeWechat' }, result.selectedId);
    if (automatic.changed) finalResult = { ...result, doc: automatic.doc, selectedId: automatic.selectedId, optimization: automatic.optimization, autoOptimized: true };
  }
  if (!finalResult.changed) { setStatus(intent.type === 'optimizeWechat' ? '微信发布约束检查完成，无需修改' : '没有可应用的变化'); return false; }
  selectedId = finalResult.selectedId;
  doc = store.commit(finalResult.doc, label);
  let statusLabel = label;
  if (intent.type === 'autoComposeVisuals' && intent.fillUnmatched) {
    const placements = doc.meta?.visualPlan?.placements || [];
    const matched = placements.filter(item => item.assetId && item.anchorId).length;
    const appended = placements.filter(item => item.assetId && !item.anchorId).length;
    statusLabel = `图片内容识别完成：匹配 ${matched} 个章节${appended ? `，补充 ${appended} 张图片` : ''}`;
  }
  if (intent.type === 'optimizeWechat' || finalResult.autoOptimized) {
    const optimization = finalResult.optimization;
    statusLabel = optimization?.changes?.length ? optimization.changes.join('；') : '微信发布约束检查完成，无需修改';
  }
  if (intent.type === 'smartCover') {
    const coverBlock = doc.blocks.find(block => block.type === 'image' && block.visualRole === 'cover');
    const coverAsset = coverBlock ? assetById(coverBlock.assetId) : null;
    statusLabel = coverAsset
      ? `封面一键设置完成，内容摘要已同步（${coverAsset.width || 900}×${coverAsset.height || 383}）`
      : '封面设置完成，请在素材库确认图片';
  }
  persist(); render(); setStatus(statusLabel);
  window.dispatchEvent(new CustomEvent('wechat-layout:changed', { detail: { doc: structuredClone(doc), intent } }));
  return true;
}
function autoOptimizeLoadedDocument(){
  const automatic=reduceDocument(doc,{type:'optimizeWechat'},selectedId);
  if(!automatic.changed)return null;
  selectedId=automatic.selectedId;
  doc=store.commit(automatic.doc,'加载时自动微信约束优化');
  persist();
  return automatic.optimization;
}

function render() {
  document.querySelector('#app').innerHTML = `
  <div class="shell theme-${normalizeTheme(doc.theme)}">
    <header class="topbar">
      <div><strong>公众号排版</strong><span class="badge">MVP v${APP_VERSION}</span></div>      <div class="top-actions">
        <button id="undoBtn">↶ 回滚</button><button id="redoBtn">↷ 重做</button>
        <button id="visualComposeBtn" title="根据文章语义生成标题图，并把素材/创意图放到合适章节">智能配图与标题</button><button id="assetAutoFillBtn" title="识别图片内容（文件名、描述、OCR/视觉标签）并匹配正文章节">图片智能导入</button><button id="wechatOptimizeBtn" title="蒸馏正文并同步优化标题、作者、摘要、封面文案，动态刷新公众号页面预览">智能优化发布约束</button><button id="draftBtn" class="primary-button">导出到微信草稿箱</button><button id="exportHtmlBtn">导出微信 HTML</button>
        <label class="button primary-button">导入文章+图片<input id="articleImportInput" type="file" accept=".md,.markdown,.txt,text/plain,image/*" multiple hidden></label>
      </div>
    </header>
    <main class="workspace">
      <aside class="panel left-panel">
        <section class="library-section"><div id="libraryPane">${renderLibraryPane()}</div></section>
        ${renderGrowthPanel()}
        <section class="outline-section"><div class="section-head"><h3>文章结构</h3><span class="hint">${doc.blocks.length} 个区块</span></div><div class="outline">${doc.blocks.map((b,i)=>`<button class="outline-item ${b.id===selectedId?'active':''}" data-select="${b.id}"><span>${i+1}</span>${b.type==='image'?'图片':esc(b.text.slice(0,18)||'空内容')}</button>`).join('')}</div></section>
        <section><h3>版本记录</h3><div class="versions">${store.list().slice(-8).reverse().map(v=>`<div><b>#${v.seq}</b><span>${esc(v.label)}</span><time>${new Date(v.ts).toLocaleTimeString()}</time></div>`).join('')}</div></section>
      </aside>
      <section class="panel editor-panel">
        <div id="importDrop" class="import-drop"><strong>拖入文章或图片，自动排版</strong><span>自动总结正文、生成爆款标题与标题图，并从素材库按章节智能填充；导入后可继续人工调整</span></div>
        <div class="command-box"><div class="command-label">文字指令</div><div class="command-row"><textarea id="commandInput" rows="1" placeholder="如：把当前改成引用 / 拆分当前段落 / 添加表格：列1|列2"></textarea><button id="runCommand">执行</button></div><div class="hint">支持按区块转换、拆分、主题切换和组件创建；表格可用换行或分号分隔；未识别的文字会作为新段落。</div></div>
        <div class="guidance-box"><div class="command-label">自动排版指导</div><div id="guidanceList">${renderGuidance()}</div></div>
        ${renderWechatLimits()}
        <div class="humanizer-box"><div class="command-label">去 AI 味</div><div class="humanizer-row"><select id="humanizerMode"><option value="natural" ${doc.meta.humanizer?.mode === 'natural' ? 'selected' : ''}>自然化</option><option value="conservative" ${doc.meta.humanizer?.mode === 'conservative' ? 'selected' : ''}>保守调整</option></select><button id="humanizeBtn">应用到正文</button></div><div class="hint">本地确定性处理，原稿保存在导入记录中，可随时回滚。</div></div>
        ${renderCoverSummaryPanel()}
        <div class="title-editor"><div class="title-row"><input id="titleInput" maxlength="${WECHAT_LIMITS.titleChars}" value="${esc(doc.title)}" aria-label="标题"><button id="viralTitleBtn" type="button" title="根据正文总结并生成爆款标题">生成爆款标题</button></div><input id="authorInput" maxlength="${WECHAT_LIMITS.authorChars}" value="${esc(doc.author || '')}" aria-label="作者" placeholder="作者（可选，最多 16 字）"><div class="title-ai-panel">${renderTitlePlan()}</div></div>
        <div class="blocks">${doc.blocks.filter(block => !(block.type === 'image' && block.visualRole === 'cover')).map(renderEditorBlock).join('')}</div>
        <div class="insert-row"><button data-add="heading">+ 标题</button><button data-add="paragraph">+ 段落</button><button data-add="quote">+ 引用</button><button data-add="list">+ 列表</button><button data-add="table">+ 表格</button><button data-add="cta">+ CTA</button><button data-add="gallery">+ 画廊</button><button data-add="media">+ 媒体</button></div>
      </section>
      <aside class="panel preview-panel">
        <div class="preview-toolbar"><div><b>微信文章实时预览</b><span>仅视觉缩放，不改变内容</span></div><div class="preview-controls"><label>主题<select id="themeSelect">${Object.values(THEMES).map(theme => `<option value="${theme.id}" ${normalizeTheme(doc.theme) === theme.id ? 'selected' : ''}>${theme.label}</option>`).join('')}</select></label><button id="wechatCheckBtn" class="check-button" title="检查微信字段、正文、封面和素材，并自动优化可安全修正项">一键检测</button><div class="zoom"><button id="zoomOut">−</button><span id="zoomText">${Math.round(zoom*100)}%</span><button id="zoomIn">＋</button><button id="zoomReset">1:1</button></div></div></div>
        <div class="phone-stage"><article class="wechat-article theme-${normalizeTheme(doc.theme)}" style="transform:scale(${zoom})">${renderPreview()}</article></div>
      </aside>
    </main>
    <footer class="statusbar"><span id="statusText">${esc(status)}</span><span id="revisionText">v${doc.meta.revision} · ${new Date(doc.meta.updatedAt).toLocaleTimeString()}</span></footer>
    <dialog id="draftDialog"><form method="dialog" class="draft-dialog"><div class="draft-dialog-head"><div><strong>导出到微信草稿箱</strong><p>先生成微信兼容草稿包，再按授权配置提交到公众号草稿箱。</p></div><button value="cancel" aria-label="关闭">×</button></div><div class="draft-status" id="draftStatus">正在检查本机授权配置…</div><div id="draftLimitBox"></div><div id="qrAuthBox" class="qr-auth" hidden></div><div class="draft-note"><b>授权说明</b><span>二维码由已配置的授权适配器提供；扫码完成后，适配器只需向本机回调地址提交凭据。凭据保存在本机 .local-data，下次启动自动复用。</span></div><div class="draft-actions"><button id="localDraftBtn" type="button">仅生成本地草稿包</button><button id="submitDraftBtn" type="button" class="primary-button">提交到公众号草稿箱</button></div><div class="draft-foot">草稿包由系统自动生成，普通编辑无需处理 JSON。</div></form></dialog>
  </div>`;
  bindEvents();
}
function renderEditorBlock(b) {
  if (b.type === 'image') {
    const a = assetById(b.assetId);
    return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}">${a?`<img class="editor-image" src="${a.dataUrl}" alt="${esc(b.text)}">`:'<div class="missing">图片素材已丢失</div>'}<div class="image-replace-hint">先选中图片，再点击素材库里的“替换当前”</div><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
  }
  if (b.type === 'list') {
    return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}"><div class="special-label">${b.ordered?'有序':'无序'}列表</div><textarea class="special-editor" data-list-edit="${b.id}">${esc((b.items || b.text?.split('\n') || []).join('\n'))}</textarea><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
  }
  if (b.type === 'table') {
    const value = [b.headers || [], ...(b.rows || [])].map(row => row.join(' | ')).join('\n');
    return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}"><div class="special-label">数据表格</div><textarea class="special-editor" data-table-edit="${b.id}">${esc(value)}</textarea><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
  }
  if (b.type === 'cta') {
    return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}"><div class="special-label">CTA · ${esc(b.buttonText || '立即了解')}</div><div class="editable block-cta" contenteditable="true" spellcheck="false" data-component-edit="${b.id}">${esc(b.text)}</div><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
  }
  if (b.type === 'gallery') {
    const images = (b.assetIds || []).map(assetById).filter(Boolean).map(asset => `<img src="${asset.dataUrl}" alt="${esc(asset.alt || asset.name)}">`).join('');
    return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}"><div class="special-label">画廊 · ${b.assetIds?.length || 0} 张图片</div><div class="editor-gallery">${images || '<span>请使用“添加画廊：图片名”插入素材</span>'}</div><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
  }
  if (b.type === 'media') {
    return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}"><div class="special-label">媒体 · ${esc(b.mediaType || 'video')}</div><div class="editable block-media" contenteditable="true" spellcheck="false" data-component-edit="${b.id}">${esc(b.text)}</div><div class="hint">${esc(b.url || '未设置媒体地址')}</div><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
  }
  if (b.type === 'list') {
    return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}"><div class="special-label">${b.ordered?'有序':'无序'}列表</div><textarea class="special-editor" data-list-edit="${b.id}">${esc((b.items || b.text?.split('\n') || []).join('\n'))}</textarea><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
  }
  if (b.type === 'table') {
    const value = [b.headers || [], ...(b.rows || [])].map(row => row.join(' | ')).join('\n');
    return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}"><div class="special-label">数据表格</div><textarea class="special-editor" data-table-edit="${b.id}">${esc(value)}</textarea><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
  }
  if (b.type === 'cta') {
    return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}"><div class="special-label">CTA · ${esc(b.buttonText || '立即了解')}</div><div class="editable block-cta" contenteditable="true" spellcheck="false" data-component-edit="${b.id}">${esc(b.text)}</div><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
  }
  if (b.type === 'gallery') {
    const images = (b.assetIds || []).map(assetById).filter(Boolean).map(asset => `<img src="${asset.dataUrl}" alt="${esc(asset.alt || asset.name)}">`).join('');
    return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}"><div class="special-label">画廊 · ${b.assetIds?.length || 0} 张图片</div><div class="editor-gallery">${images || '<span>请使用“添加画廊：图片名”插入素材</span>'}</div><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
  }
  if (b.type === 'media') {
    return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}"><div class="special-label">媒体 · ${esc(b.mediaType || 'video')}</div><div class="editable block-media" contenteditable="true" spellcheck="false" data-component-edit="${b.id}">${esc(b.text)}</div><div class="hint">${esc(b.url || '未设置媒体地址')}</div><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
  }
  const cls = b.type === 'heading' ? 'block-heading' : b.type === 'quote' ? 'block-quote' : 'block-paragraph';
  return `<div class="block ${b.id===selectedId?'selected':''}" data-block="${b.id}"><div class="editable ${cls}" contenteditable="true" spellcheck="false" data-edit="${b.id}">${esc(b.text)}</div><div class="block-tools"><button data-move="-1">↑</button><button data-move="1">↓</button><button data-delete>删除</button></div></div>`;
}

function renderPreview() {
  return renderDocumentBody(doc);
}

function renderGuidance() {
  return getLayoutGuidance(doc).map(item => {
    const icon = item.level === 'ok' ? '✓' : item.level === 'error' ? '!' : '•';
    const action = item.command ? `<button class="guidance-action" data-guidance="${esc(item.command)}">带入指令</button>` : '';
    return `<div class="guidance-item guidance-${item.level}"><span>${icon}</span><p>${esc(item.text)}</p>${action}</div>`;
  }).join('');
}

function getWechatDraftValidation() {
  const article = inspectWechatArticle({ title: doc.title, author: doc.author || '', digest: doc.subtitle || '', content: renderArticleHtml(doc) });
  const coverBlock = doc.blocks.find(block => block.type === 'image' && (block.visualRole === 'cover' || block.id === doc.blocks.find(item => item.type === 'image')?.id));
  const coverAsset = coverBlock ? assetById(coverBlock.assetId) : null;
  const cover = coverAsset ? inspectWechatCover({ width: coverAsset.width, height: coverAsset.height, bytes: coverAsset.size, type: coverAsset.type, main: coverAsset.coverMain || '', sub: coverAsset.coverSub || '' }) : null;
  const coverErrors = cover ? cover.errors.map(message => ({ id: 'titleImage', label: '标题图片', message })) : [{ id: 'titleImage', label: '标题图片', message: '未插入封面图片，提交公众号草稿箱前必须设置封面' }];
  return { ...article, cover, ok: article.ok && coverErrors.length === 0, errors: [...article.errors, ...coverErrors] };
}

function renderWechatLimits(validation = getWechatDraftValidation()) {
  const { fields } = validation;
  const checks = [
    { id: 'title', label: '标题', text: `${fields.title}/${WECHAT_LIMITS.titleChars} 字` },
    { id: 'author', label: '作者', text: `${fields.author}/${WECHAT_LIMITS.authorChars} 字` },
    { id: 'digest', label: '摘要', text: `${fields.digest}/${WECHAT_LIMITS.digestChars} 字` },
    { id: 'contentChars', label: '正文字符', text: `${fields.contentChars.toLocaleString('zh-CN')} / <${WECHAT_LIMITS.contentChars.toLocaleString('zh-CN')} 字` },
    { id: 'contentBytes', label: '正文大小', text: `${formatBytes(fields.contentBytes)} / <1.00MB` }
  ];
  if (validation.cover) checks.push({ id: 'titleImage', label: '标题图片', text: `${validation.cover.fields.mainChars}/${WECHAT_LIMITS.titleImage.mainChars} 字 · ${validation.cover.fields.subChars}/${WECHAT_LIMITS.titleImage.subChars} 字 · ${validation.cover.fields.width && validation.cover.fields.height ? `${validation.cover.fields.width}×${validation.cover.fields.height}` : '尺寸待检测'} · ${validation.cover.fields.type || '格式待检测'}` });
  else checks.push({ id: 'titleImage', label: '标题图片', text: '未插入（提交时必需封面）', pending: true });
  const optimization = doc.meta?.wechatOptimization;
  const optimizationNote = optimization?.changes?.length ? `<p class="wechat-limit-hint">最近一次智能优化：${esc(optimization.changes.join('；'))}</p>` : '';
  const seriesNote = optimization?.seriesPlan?.count > 1 ? `<p class="wechat-limit-error">正文建议拆分为 ${optimization.seriesPlan.count} 篇系列草稿；原文未删除。</p>` : '';
  const checkNote = lastWechatCheck ? `<p class="wechat-check-note">最近检测：${esc(lastWechatCheck.summary)} · ${esc(lastWechatCheck.at)}</p>` : '';
  return `<div class="wechat-limits ${validation.ok ? 'ok' : 'error'}"><div class="command-label">微信发布限制</div><div class="wechat-limit-grid">${checks.map(item => { const result = item.id === 'titleImage' ? validation.cover : validation.checks.find(check => check.id === item.id); const ok = item.pending ? false : result?.ok; return `<span class="wechat-limit-item ${item.pending ? 'pending' : ok ? 'ok' : 'error'}"><b>${item.pending ? '·' : ok ? '✓' : '!'}</b>${item.label} ${item.text}</span>`; }).join('')}</div>${validation.errors.length ? `<p class="wechat-limit-error">${esc(validation.errors[0].message)}。可先导出本地草稿包，修改后再提交。</p>` : validation.cover?.warnings?.length ? `<p class="wechat-limit-hint">${esc(validation.cover.warnings.join('；'))}</p>` : '<p class="wechat-limit-hint">提交公众号草稿箱时将按以上限制再次校验。</p>'}${optimizationNote}${seriesNote}${checkNote}</div>`;
}

function renderDraftLimitBox(validation = getWechatDraftValidation()) {
  const el = document.querySelector('#draftLimitBox');
  if (el) el.innerHTML = renderWechatLimits(validation);
}

function coverForDocument(documentValue = {}) {
  const blocks = Array.isArray(documentValue.blocks) ? documentValue.blocks : [];
  const block = blocks.find(item => item.type === 'image' && item.visualRole === 'cover') || blocks.find(item => item.type === 'image') || null;
  const asset = block ? (documentValue.assets || []).find(item => item.id === block.assetId) || null : null;
  return { block, asset };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('封面图片无法读取'));
    image.src = dataUrl;
  });
}

/**
 * The local creative provider deliberately emits SVG because it is fast and
 * deterministic. WeChat's draft API accepts PNG/JPEG only, so the GUI
 * converts an unsupported cover into the frozen 900×383 head-image slot before
 * reporting the result. The original data URL is retained for undo/debugging.
 */
async function rasterizeWechatCover(asset) {
  if (!asset?.dataUrl) return null;
  const image = await loadImage(asset.dataUrl);
  const width = WECHAT_LIMITS.titleImage.headline.w;
  const height = WECHAT_LIMITS.titleImage.headline.h;
  const sourceWidth = Number(image.naturalWidth || asset.width || width);
  const sourceHeight = Number(image.naturalHeight || asset.height || height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持封面图片转换');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  // Cover-fit into 900×383 so an arbitrary imported ratio cannot leave the
  // title image slot in an invalid state. The generated SVG already matches.
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  let type = 'image/png';
  let dataUrl = canvas.toDataURL(type);
  // PNG is lossless and the safest default. If an unusually large cover is
  // produced, fall back to a quality-controlled JPEG under the API limit.
  if (Math.round(dataUrl.length * 0.75) > WECHAT_LIMITS.titleImage.maxBytes) {
    type = 'image/jpeg';
    dataUrl = canvas.toDataURL(type, 0.84);
  }
  return {
    ...asset,
    name: String(asset.name || 'draftloom-cover').replace(/\.(svg|webp|gif|bmp)$/i, '') + (type === 'image/png' ? '.png' : '.jpg'),
    type,
    dataUrl,
    size: Math.round(dataUrl.length * 0.75),
    width,
    height,
    sourceType: asset.type || String(asset.dataUrl).match(/^data:([^;,]+)/i)?.[1] || '',
    sourceDataUrl: asset.sourceDataUrl || asset.dataUrl
  };
}

function coverNeedsRaster(asset, validation) {
  const type = String(asset?.type || String(asset?.dataUrl || '').match(/^data:([^;,]+)/i)?.[1] || '').toLowerCase();
  const accepted = WECHAT_LIMITS.titleImage.acceptedTypes.map(value => value.toLowerCase());
  const ratio = Number(validation?.fields?.width || 0) / Number(validation?.fields?.height || 1);
  const targetRatio = WECHAT_LIMITS.titleImage.headline.w / WECHAT_LIMITS.titleImage.headline.h;
  return !accepted.includes(type)
    || !Number.isFinite(ratio)
    || Math.abs(ratio - targetRatio) >= 0.03
    || Number(validation?.fields?.width || 0) > WECHAT_LIMITS.titleImage.maxWidthPx
    || Number(validation?.fields?.bytes || 0) > WECHAT_LIMITS.titleImage.maxBytes;
}

/** Apply deterministic field fixes and browser-only cover conversion in one action. */
async function autoRepairWechatConstraints(label = '一键检测与优化') {
  setStatus('正在智能检测并修复微信发布限制…');
  let candidate = structuredClone(doc);
  let candidateSelectedId = selectedId;
  const changes = [];

  const optimized = reduceDocument(candidate, { type: 'optimizeWechat' }, candidateSelectedId);
  if (optimized.error) { setStatus(optimized.error); return { changed: false, error: optimized.error }; }
  if (optimized.changed) {
    candidate = optimized.doc;
    candidateSelectedId = optimized.selectedId;
    changes.push(...(optimized.optimization?.changes || []));
  }

  let cover = coverForDocument(candidate);
  if (!cover.asset) {
    const coverResult = reduceDocument(candidate, { type: 'smartCover' }, candidateSelectedId);
    if (coverResult.error) { setStatus(coverResult.error); return { changed: false, error: coverResult.error }; }
    if (coverResult.changed) {
      candidate = coverResult.doc;
      candidateSelectedId = coverResult.selectedId;
      changes.push('已自动生成并设置公众号封面');
      // smartCover can create a new SVG, so inspect it again below.
      cover = coverForDocument(candidate);
    }
  }

  if (cover.asset) {
    const coverValidation = inspectWechatCover({
      width: cover.asset.width,
      height: cover.asset.height,
      bytes: cover.asset.size,
      type: cover.asset.type,
      main: cover.asset.coverMain || '',
      sub: cover.asset.coverSub || ''
    });
    if (coverNeedsRaster(cover.asset, coverValidation)) {
      try {
        const raster = await rasterizeWechatCover(cover.asset);
        candidate.assets = candidate.assets.map(asset => asset.id === cover.asset.id ? raster : asset);
        changes.push(`封面已自动转换为 PNG（${raster.width}×${raster.height}）`);
      } catch (error) {
        changes.push(`封面自动转换失败：${error.message}`);
      }
    }
  }

  // Re-run the reducer after inserting/converting the cover so its copy and
  // distilled summary are synchronized with the final document state.
  const finalOptimize = reduceDocument(candidate, { type: 'optimizeWechat' }, candidateSelectedId);
  if (finalOptimize.changed) {
    candidate = finalOptimize.doc;
    candidateSelectedId = finalOptimize.selectedId;
    changes.push(...(finalOptimize.optimization?.changes || []));
  }
  const optimization = candidate.meta?.wechatOptimization || {};
  candidate.meta = {
    ...(candidate.meta || {}),
    wechatOptimization: {
      ...optimization,
      at: new Date().toISOString(),
      changes: [...new Set([...(optimization.changes || []), ...changes])]
    }
  };
  // Avoid creating a new version merely because the reducer refreshed its
  // diagnostic timestamp when the document is already compliant.
  if (!changes.length && doc.meta?.wechatOptimization) {
    candidate.meta.wechatOptimization = structuredClone(doc.meta.wechatOptimization);
  }

  const changed = JSON.stringify(candidate) !== JSON.stringify(doc);
  if (changed) {
    selectedId = candidateSelectedId;
    commit({ type: 'replaceDocument', doc: candidate }, label);
  } else {
    render();
  }
  return { changed, changes: [...new Set(changes)], validation: getWechatDraftValidation() };
}

async function runWechatCheck() {
  const repair = await autoRepairWechatConstraints('一键检测与优化');
  const validation = getWechatDraftValidation();
  const guidance = getLayoutGuidance(doc);
  const errors = validation.errors || [];
  const pendingGuidance = guidance.filter(item => item.level !== 'ok').length;
  const summary = errors.length
    ? `仍有 ${errors.length} 项微信发布限制需要人工处理`
    : repair.changed
      ? '已自动修正可安全修正项，正文超限已完成蒸馏检查'
      : pendingGuidance
        ? `规则已通过，另有 ${pendingGuidance} 项排版建议可人工调整`
        : '当前内容符合微信发布规则';
  lastWechatCheck = { summary, at: new Date().toLocaleTimeString() };
  document.querySelectorAll('.editor-panel .wechat-limits').forEach(el => { el.outerHTML = renderWechatLimits(validation); });
  renderDraftLimitBox(validation);
  setStatus(`一键检测完成：${summary}`);
  return { changed: repair.changed, validation: structuredClone(validation), guidance: structuredClone(guidance) };
}

function bindLibraryEvents() {
  document.querySelectorAll('[data-library-tab]').forEach(el => el.onclick = () => { libraryTab = el.dataset.libraryTab; assetQuery = ''; assetFilter = 'all'; refreshLibraryPane(); });
  const search = document.querySelector('#assetSearch');
  if (search) search.oninput = e => { assetQuery = e.target.value; refreshLibraryPane(); const next = document.querySelector('#assetSearch'); next?.focus(); next?.setSelectionRange(assetQuery.length, assetQuery.length); };
  const sort = document.querySelector('[data-library-sort]');
  if (sort) sort.onclick = () => { assetSort = assetSort === 'name' ? 'recent' : 'name'; refreshLibraryPane(); };
  const filter = document.querySelector('[data-library-filter]');
  if (filter) filter.onclick = () => { assetFilter = assetFilter === 'unused' ? 'all' : 'unused'; refreshLibraryPane(); };
  const input = document.querySelector('#assetInput');
  if (input) input.onchange = handleAssets;
  document.querySelectorAll('[data-asset-insert]').forEach(el => el.onclick = e => { e.stopPropagation(); commit({type:'insertAsset', assetId:el.dataset.assetInsert}, '从素材库插入图片'); });
  document.querySelectorAll('[data-asset-replace]').forEach(el => el.onclick = e => { e.stopPropagation(); commit({type:'replaceSelectedAsset', assetId:el.dataset.assetReplace}, '从素材库替换图片'); });
  document.querySelectorAll('[data-asset-delete]').forEach(el => el.onclick = e => { e.stopPropagation(); commit({type:'deleteAsset', assetId:el.dataset.assetDelete}, '删除素材及文章中的图片'); });
  const clearUnused = document.querySelector('[data-clear-unused]');
  if (clearUnused) clearUnused.onclick = () => commit({type:'deleteUnusedAssets'}, '清理未使用素材');
  const copyScript = document.querySelector('[data-copy-script]');
  if (copyScript) copyScript.onclick = async () => { const source = doc.original?.text || ''; try { await navigator.clipboard.writeText(source); setStatus('文字稿已复制'); } catch { setStatus('复制失败，请手动选择文字稿'); } };
}

function bindEvents() {
  document.querySelectorAll('[data-select]').forEach(el=>el.onclick=()=>{selectedId=el.dataset.select; render();});
  document.querySelectorAll('[data-block]').forEach(el=>el.onclick=(e)=>{ if(!e.target.closest('button')){selectedId=el.dataset.block; document.querySelectorAll('.block').forEach(x=>x.classList.toggle('selected',x.dataset.block===selectedId));}});  document.querySelectorAll('[data-edit]').forEach(el=>{
    el.onfocus=()=>{ selectedId=el.dataset.edit; };
    el.onblur=()=>commit({type:'updateBlock', id:el.dataset.edit, text:el.textContent.trim()}, '编辑内容');
  });
  document.querySelectorAll('[data-list-edit]').forEach(el=>{
    el.onfocus=()=>{ selectedId=el.dataset.listEdit; };
    el.onblur=()=>{ const items=el.value.split(/\n+/).map(item=>item.trim()).filter(Boolean); commit({type:'updateBlock', id:el.dataset.listEdit, text:items.join('\n'), items}, '编辑列表'); };
  });
  document.querySelectorAll('[data-table-edit]').forEach(el=>{
    el.onfocus=()=>{ selectedId=el.dataset.tableEdit; };
    el.onblur=()=>{ const rows=el.value.split(/\n+/).map(row=>row.split('|').map(cell=>cell.trim()).filter(Boolean)).filter(row=>row.length); commit({type:'updateBlock', id:el.dataset.tableEdit, text:'数据表格', headers:rows[0]||[], rows:rows.slice(1)}, '编辑表格'); };
  });
  document.querySelectorAll('[data-component-edit]').forEach(el=>{
    el.onfocus=()=>{ selectedId=el.dataset.componentEdit; };
    el.onblur=()=>commit({type:'updateBlock', id:el.dataset.componentEdit, text:el.textContent.trim()}, '编辑组件');
  });
  document.querySelectorAll('[data-move]').forEach(el=>el.onclick=(e)=>{selectedId=e.target.closest('[data-block]').dataset.block;commit({type:'moveSelected',direction:Number(el.dataset.move)},'移动内容');});
  document.querySelectorAll('[data-delete]').forEach(el=>el.onclick=(e)=>{selectedId=e.target.closest('[data-block]').dataset.block;commit({type:'deleteSelected'},'删除内容');});
  document.querySelectorAll('[data-add]').forEach(el=>el.onclick=()=>{
    const type=el.dataset.add;
    const defaults={heading:{text:'新标题',level:2},paragraph:{text:'新的段落'},quote:{text:'新的引用'},list:{text:'项目一\n项目二',items:['项目一','项目二']},table:{text:'数据表格',headers:['列1','列2'],rows:[['内容','备注']]},cta:{text:'欢迎继续阅读',buttonText:'立即了解'},gallery:{text:'图片组',assetIds:[]},media:{text:'媒体内容',mediaType:'video',url:''}};
    commit({type:'appendBlock',blockType:type,...defaults[type]},'新增内容');
  });
  const run = ()=>{ const input=document.querySelector('#commandInput'); const text=input.value; if(commit(parseCommand(text),`指令：${text.slice(0,24)}`)) input.value=''; };
  document.querySelector('#runCommand').onclick=run;  document.querySelector('#commandInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();run();}};
  document.querySelector('#titleInput').onchange=e=>commit({type:'setTitle',text:e.target.value.trim()},'修改标题');
  document.querySelector('#authorInput').onchange=e=>commit({type:'setAuthor',text:e.target.value.trim()},'修改作者');
  document.querySelector('#subtitleInput').onchange=e=>commit({type:'setSubtitle',text:e.target.value.trim()},'修改副标题');
  document.querySelector('#coverAssetSelect').onchange=e=>commit({type:'setCoverAsset',assetId:e.target.value},'设置公众号封面');
  document.querySelector('#coverMainInput').onchange=e=>{const sub=document.querySelector('#coverSubInput')?.value || '';commit({type:'setCoverCopy',main:e.target.value.trim(),sub},'修改封面主文案');};
  document.querySelector('#coverSubInput').onchange=e=>{const main=document.querySelector('#coverMainInput')?.value || '';commit({type:'setCoverCopy',main,sub:e.target.value.trim()},'修改封面副文案');};
  document.querySelector('#humanizeBtn').onclick=()=>{const mode=document.querySelector('#humanizerMode').value;commit({type:'humanize',mode},`去 AI 味：${mode==='natural'?'自然化':'保守调整'}`);};
  document.querySelector('#themeSelect').onchange=e=>commit({type:'setTheme',theme:e.target.value},'切换主题');
  document.querySelector('#undoBtn').onclick=()=>{doc=store.undo(doc);persist();render();setStatus('已回滚一步');};
  document.querySelector('#redoBtn').onclick=()=>{doc=store.redo(doc);persist();render();setStatus('已重做一步');};
  document.querySelector('#zoomOut').onclick=()=>setZoom(zoom-.1); document.querySelector('#zoomIn').onclick=()=>setZoom(zoom+.1); document.querySelector('#zoomReset').onclick=()=>setZoom(1);
  document.querySelector('#draftBtn').onclick=openDraftDialog;
  document.querySelector('#visualComposeBtn').onclick=()=>commit({type:'autoComposeVisuals',generate:true,maxGenerated:3,titleMode:'viral'},'智能配图与标题');
  document.querySelector('#coverAutoBtn').onclick=()=>commit({type:'smartCover'},'封面一键设置');
  document.querySelector('#assetAutoFillBtn').onclick=()=>commit({type:'autoComposeVisuals',generate:false,maxGenerated:0,fillUnmatched:true,titleMode:'safe'},'图片智能导入');
  document.querySelector('#wechatCheckBtn').onclick=runWechatCheck;
  document.querySelector('#wechatOptimizeBtn').onclick=()=>autoRepairWechatConstraints('智能优化微信发布约束').then(() => {
    const validation = getWechatDraftValidation();
    document.querySelectorAll('.editor-panel .wechat-limits').forEach(el => { el.outerHTML = renderWechatLimits(validation); });
    renderDraftLimitBox(validation);
    setStatus(validation.ok ? '智能优化完成：已自动修复微信发布限制' : `智能优化完成：仍有 ${validation.errors.length} 项限制需处理`);
  }).catch(error => setStatus(`智能优化失败：${error.message}`));
  document.querySelector('#viralTitleBtn').onclick=()=>commit({type:'autoComposeVisuals',generate:false,maxGenerated:0,titleMode:'viral',forceTitle:true},'生成爆款标题');
  document.querySelectorAll('[data-title-candidate]').forEach(el=>el.onclick=()=>commit({type:'setTitle',text:el.dataset.titleCandidate},'采用标题候选'));
  document.querySelector('#localDraftBtn').onclick=()=>{exportDraftBundle();document.querySelector('#draftDialog')?.close();};
  document.querySelector('#submitDraftBtn').onclick=submitDraftToWechat;  document.querySelector('#exportHtmlBtn').onclick=exportHtml;
  document.querySelector('#articleImportInput').onchange=e=>handleArticleImport(e.target.files);
  const drop = document.querySelector('#importDrop');
  drop.onclick=()=>document.querySelector('#articleImportInput').click();
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragging');};
  drop.ondragleave=()=>drop.classList.remove('dragging');
  drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragging');const files=e.dataTransfer.files;if(files.length)handleArticleImport(files);else{const text=e.dataTransfer.getData('text/plain');if(text)handleArticleImport([],text);}};
  document.querySelectorAll('[data-guidance]').forEach(el=>el.onclick=()=>{const input=document.querySelector('#commandInput');input.value=el.dataset.guidance;input.focus();});
  bindLibraryEvents();
  const growthAnalyzeButton = document.querySelector('#growthAnalyze');
  if (growthAnalyzeButton) growthAnalyzeButton.onclick = () => {
    growthProfile = normalizeGrowthProfile({
      accountName: document.querySelector('#growthAccount')?.value,
      positioning: document.querySelector('#growthPositioning')?.value,
      audience: document.querySelector('#growthAudience')?.value,
      tone: document.querySelector('#growthTone')?.value,
      targetKeywords: document.querySelector('#growthKeywords')?.value,
      cta: document.querySelector('#growthCta')?.value
    });
    saveGrowthProfile();
    growthReport = analyzeGrowth(doc, growthProfile);
    render();
    setStatus(`创作画像分析：${growthReport.viral.score} 分，${growthReport.compliance.decision}`);
  };
  const growthCopyButton = document.querySelector('#growthCopyBrief');
  if (growthCopyButton) growthCopyButton.onclick = async () => {
    if (!growthReport) return;
    try { await navigator.clipboard.writeText(growthBriefText(growthReport.brief)); setStatus('创作简报已复制，可交给 Agent 继续创作'); } catch { setStatus('复制失败，请展开分析结果后手动记录'); }
  };
}
function setZoom(v){ zoom=Math.min(1.4,Math.max(.6,Math.round(v*10)/10)); const article=document.querySelector('.wechat-article'); article.style.transform=`scale(${zoom})`; document.querySelector('#zoomText').textContent=`${Math.round(zoom*100)}%`; }
async function handleAssets(e){
  const files=[...e.target.files].slice(0, Math.max(0, MAX_ASSETS - doc.assets.length));
  if(!files.length)return;
  try {
    setStatus(`正在处理 ${files.length} 张图片…`);
    const assets=await Promise.all(files.map(async file=>{
      const prepared=await optimizeImageFile(file);
      return {id:crypto.randomUUID(),name:file.name,type:prepared.type,size:prepared.size,dataUrl:prepared.dataUrl,alt:file.name.replace(/\.[^.]+$/,'')};
    }));
    if(commit({type:'addAssets',assets},`素材批量入库：${assets.length} 张`)) setStatus(`已上传 ${assets.length} 张，可从素材库直接调用`);
    if (e.target.files.length > files.length) setStatus(`已达到素材容量 ${MAX_ASSETS} 张，超出部分未导入`);
  } catch(err) { setStatus(`素材上传失败：${err.message}`); }
  e.target.value='';
}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}
async function optimizeImageFile(file){
  const original=await fileToDataUrl(file);
  if(!/^image\/(png|jpe?g|webp)$/i.test(file.type)||file.size<220000)return {dataUrl:original,type:file.type||'image/png',size:file.size};
  const image=await new Promise((resolve,reject)=>{const element=new Image();element.onload=()=>resolve(element);element.onerror=reject;element.src=original;});
  const maxEdge=1600, scale=Math.min(1,maxEdge/image.naturalWidth,maxEdge/image.naturalHeight);
  if(scale===1&&file.size<550000)return {dataUrl:original,type:file.type,size:file.size};
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const dataUrl=canvas.toDataURL('image/jpeg',0.82);
  return {dataUrl,type:'image/jpeg',size:Math.round((dataUrl.length*3)/4)};
}
async function optimizeWechatForSubmit(){
  const dialogWasOpen=Boolean(document.querySelector('#draftDialog')?.open);
  const result = await autoRepairWechatConstraints('提交前智能优化微信发布约束');
  if (dialogWasOpen && !document.querySelector('#draftDialog')?.open) document.querySelector('#draftDialog')?.showModal();
  return result;
}
function exportHtml(){ const html=renderArticleHtml(doc); const blob=new Blob([html],{type:'text/html;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`wechat-layout-${doc.meta.revision}.html`;a.click();URL.revokeObjectURL(a.href);setStatus('已导出 HTML'); }
function createDraftBundle(){
  const html=renderArticleHtml(doc);
  const wechatLimits=getWechatDraftValidation();
  const coverBlock=currentCoverBlock();
  const coverAsset=coverBlock?assetById(coverBlock.assetId):null;
  return {format:'wechat-draft-bundle-v1',generatedAt:new Date().toISOString(),revision:doc.meta.revision,wechatLimits,cover:coverAsset?{assetId:coverAsset.id,name:coverAsset.name,type:coverAsset.type,width:coverAsset.width||900,height:coverAsset.height||383,main:coverAsset.coverMain||'',sub:coverAsset.coverSub||''}:null,payload:{articles:[{article_type:'news',title:doc.title,author:doc.author||'',digest:doc.subtitle||'',content:html,content_source_url:''}]},html};
}
function exportDraftBundle(){ const bundle=createDraftBundle(); const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`wechat-draft-${doc.meta.revision}.json`;a.click();URL.revokeObjectURL(a.href);setStatus(bundle.wechatLimits.ok?'已生成本地微信草稿包（封面、摘要、正文及图片已包含）':`已生成本地草稿包（封面、摘要、正文及图片已包含），但有微信限制提示：${bundle.wechatLimits.errors[0].message}`); }
async function openDraftDialog(){
  const dialog=document.querySelector('#draftDialog');
  if(!dialog)return;
  if(!dialog.open) dialog.showModal();
  const statusEl=document.querySelector('#draftStatus');
  const validation=getWechatDraftValidation();
  renderDraftLimitBox(validation);
  try {
    const response=await fetch('/api/wechat/status');
    const value=await response.json();
    statusEl.textContent=!validation.ok?`当前文章不能提交：${validation.errors[0].message}`:value.authorized?(autoSubmitAfterAuth?'授权成功，正在上传图片并创建公众号草稿…':'已完成公众号授权，本机凭据会自动复用。'):value.remoteReady?'已检测到微信接口配置，可提交草稿。':'当前为本地模式：尚未完成公众号授权。';
    statusEl.className=`draft-status ${value.remoteReady?'ready':'local'}`;
    renderAuthBox(value);
    const submitButton=document.querySelector('#submitDraftBtn');
    if(submitButton) submitButton.textContent=value.authorized||value.remoteReady?'提交到公众号草稿箱':value.qrAuthorization?'授权后自动上传草稿':'生成本地草稿包';
    if(submitButton) submitButton.disabled=Boolean(value.remoteReady&&!validation.ok);
    clearTimeout(authPollTimer);
    if (!value.authorized) authPollTimer=setTimeout(()=>{ if(dialog.open) openDraftDialog(); }, 2500);
    else if (autoSubmitAfterAuth) { autoSubmitAfterAuth=false; clearTimeout(authPollTimer); await submitDraftToWechat({skipConfirm:true}); }
  } catch { statusEl.textContent=validation.ok?'本地服务未提供微信接口状态，将只生成本地草稿包。':`当前文章不能提交：${validation.errors[0].message}`; statusEl.className='draft-status local'; }
}
function renderAuthBox(value={}){
  const qrBox=document.querySelector('#qrAuthBox');
  if(!qrBox)return;
  qrBox.hidden=false;
  const image=value.qrImageUrl?`<img class="qr-auth-image" src="${esc(value.qrImageUrl)}" alt="公众号授权二维码">`:'';
  const link=value.qrAuthUrl?`<a href="${esc(value.qrAuthUrl)}" target="_blank" rel="noreferrer">在新窗口打开授权页</a>`:'';
  const callback=value.callbackUrl?`<code>${esc(value.callbackUrl)}</code>`:'';
  if (value.qrAuthorization) {
    qrBox.innerHTML=`<strong>扫码授权公众号</strong>${image}<div>${link}</div><small>扫码完成后等待本窗口自动刷新。授权适配器回调地址：${callback}</small>`;
  } else if (value.remoteReady) {
    qrBox.innerHTML=`<strong>已检测到本机授权配置</strong><p>当前无需扫码：本机已加载加密保存的公众号接口配置。点击“提交到公众号草稿箱”会直接上传图片并创建草稿，完成后请在公众号后台人工审核发送。</p><small>如需改用二维码授权，请配置 WECHAT_QR_IMAGE_URL（二维码图片）或 WECHAT_QR_AUTH_URL（授权页）。</small>`;
  } else {
    qrBox.innerHTML=`<strong>尚未显示二维码</strong><p>官方草稿接口本身不提供扫码登录。请在启动本机服务前配置 WECHAT_QR_IMAGE_URL（二维码图片）或 WECHAT_QR_AUTH_URL（授权页），并让授权适配器把 access_token 通过 POST 回调到本机。</p><small>本机回调地址：${callback}</small>`;
  }
}
async function submitDraftToWechat({skipConfirm=false}={}){
  let statusEl=document.querySelector('#draftStatus');
  try {
    await optimizeWechatForSubmit();
    statusEl=document.querySelector('#draftStatus');
    const validation=getWechatDraftValidation();
    renderDraftLimitBox(validation);
    if(!validation.ok){ statusEl.className='draft-status local error'; statusEl.textContent=`提交已阻止：${validation.errors[0].message}`; setStatus(`草稿导出已阻止：${validation.errors[0].message}`); return; }
    const statusResponse=await fetch('/api/wechat/status');
    if (!statusResponse.ok) { exportDraftBundle(); document.querySelector('#draftDialog')?.close(); setStatus('本地服务尚未重启，已生成本地微信草稿包'); return; }
    const statusInfo=await statusResponse.json();
    if(!statusInfo.remoteReady){
      if(statusInfo.qrAuthorization){
        if(!window.confirm('确认扫码授权后自动上传图片并创建公众号草稿吗？完成后仍需在公众号后台人工审核发送。'))return;
        autoSubmitAfterAuth=true;
        statusEl.textContent='等待扫码授权…授权成功后将自动上传图片并创建草稿。';
        return;
      }
      exportDraftBundle(); if(document.querySelector('#draftDialog')?.open)document.querySelector('#draftDialog').close(); return;
    }
    if(!skipConfirm && !window.confirm('确认将当前文章提交到已配置的公众号草稿箱吗？'))return;
    statusEl.textContent='正在上传图片并提交草稿…';
    const response=await fetch('/api/wechat/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({doc,confirm:true})});
    const result=await response.json();
    if(!response.ok||result.error)throw new Error(result.error||'提交失败');
    const submitted=result.delivery?.status==='submitted';
    const draftId=result.delivery?.draftId?String(result.delivery.draftId):'';
    if(submitted){
      const idText=draftId?`草稿编号：${esc(draftId)}`:'接口未返回草稿编号';
      const nextAction=esc(result.delivery?.nextAction||'请在微信公众号后台人工审核后发送');
      statusEl.className='draft-status ready success';
      statusEl.innerHTML=`<strong>✓ 提交成功</strong><span>文章已进入公众号草稿箱</span><small>${idText}<br>${nextAction}</small>`;
      setStatus(`草稿已进入公众号草稿箱${draftId?`（${draftId}）`:''}，请人工审核后发送`);
    } else {
      statusEl.className='draft-status local';
      statusEl.textContent='已生成本地草稿包。';
      setStatus('已生成本地微信草稿包');
    }
  } catch(error) { statusEl.className='draft-status local error'; statusEl.textContent=`提交失败：${error.message}`; setStatus(`草稿导出失败：${error.message}`); }
}async function handleArticleImport(fileList=[], pastedText=''){
  try {
    const files=[...fileList];
    const articleFile=files.find(file=>/\.(md|markdown|txt)$/i.test(file.name)||file.type.startsWith('text/'));
    const imageFiles=files.filter(file=>file.type.startsWith('image/')||/\.(png|jpe?g|webp|gif|svg)$/i.test(file.name));
    const text=articleFile?await articleFile.text():pastedText;
    if(!text&&!imageFiles.length) throw new Error('没有找到文章文字或图片');
    const newAssets=await Promise.all(imageFiles.map(async file=>{const prepared=await optimizeImageFile(file);return {id:crypto.randomUUID(),name:file.name,type:prepared.type,size:prepared.size,dataUrl:prepared.dataUrl,alt:file.name.replace(/\.[^.]+$/,'')};}));
    const assets=mergeAssets(loadAssetLibrary(), newAssets);
    const incoming=importArticle({text,filename:articleFile?.name||'pasted-article.txt',assets,autoCompose:true,visualOptions:{generate:true,maxGenerated:3,titleMode:'viral',forceTitle:true}});
    if(commit({type:'replaceDocument',doc:incoming},`自动排版导入：${articleFile?.name||`${assets.length} 张图片`}`)){
      const warnings=incoming.meta.importWarnings||[];
      const generated=incoming.meta.visualPlan?.generatedAssetIds?.length||0;
      const reused=Math.max(0,assets.length-newAssets.length);
      setStatus(warnings.length?`导入完成，${warnings.length} 条提示`:`导入完成，图片已自动入库并填充${reused?`（复用素材 ${reused} 张）`:''}${generated?`（新增创意图 ${generated} 张）`:''}`);
    }
  } catch(err) { setStatus(`导入失败：${err.message}`); }
}
window.wechatLayoutHarness = {  getState: () => structuredClone(doc),
  applyIntent: (intent, label='Harness 编辑') => commit(intent, label),
  applyText: (text) => commit(parseCommand(text), `Harness：${text.slice(0,24)}`),
  importArticle: ({text,filename='pasted-article.txt',assets=[]}) => { const incoming=importArticle({text,filename,assets:mergeAssets(loadAssetLibrary(), assets),autoCompose:true,visualOptions:{generate:true,maxGenerated:3,titleMode:'viral',forceTitle:true}}); const changed=commit({type:'replaceDocument',doc:incoming},`Harness 导入：${filename}`); return changed ? {doc:structuredClone(doc),guidance:getLayoutGuidance(doc)} : null; },
  autoComposeVisuals: (options={}) => commit({type:'autoComposeVisuals',generate:options.generate !== false,maxGenerated:options.maxGenerated ?? 3,titleMode:options.titleMode || 'viral',forceTitle:options.forceTitle === true,fillUnmatched:options.fillUnmatched === true}, options.fillUnmatched ? '图片智能导入' : '智能配图与标题'),
  coverSet: () => commit({type:'smartCover'}, '封面一键设置'),
  smartCover: () => commit({type:'smartCover'}, '封面一键设置'),
  optimizeWechat: () => commit({type:'optimizeWechat'}, '智能优化微信发布约束'),
  checkWechat: runWechatCheck,
  getLayoutGuidance: () => getLayoutGuidance(doc),
  getGrowthProfile: () => structuredClone(growthProfile),
  setGrowthProfile: (profile) => { growthProfile = normalizeGrowthProfile(profile); saveGrowthProfile(); growthReport = analyzeGrowth(doc, growthProfile); render(); return structuredClone(growthReport); },
  analyzeGrowth: (profile) => { if (profile) { growthProfile = normalizeGrowthProfile(profile); saveGrowthProfile(); } growthReport = analyzeGrowth(doc, growthProfile); render(); return structuredClone(growthReport); },
  growthBrief: (profile) => growthBrief(doc, normalizeGrowthProfile(profile || growthProfile)),
  addImage: ({name,type='image/png',dataUrl,alt=''}) => commit({type:'addAsset',asset:{id:crypto.randomUUID(),name,type,size:0,dataUrl,alt:alt||name}}, `Harness 素材：${name}`),
  replaceSelectedImage: (assetId) => commit({type:'replaceSelectedAsset',assetId}, 'Harness 替换图片'),
  deleteImage: (assetId) => commit({type:'deleteAsset',assetId}, 'Harness 删除素材'),
  selectBlock: (id) => { if(doc.blocks.some(b=>b.id===id)){selectedId=id;render();return true;} return false; },
  undo: () => { doc=store.undo(doc);persist();render();return structuredClone(doc); },
  redo: () => { doc=store.redo(doc);persist();render();return structuredClone(doc); },
  version: APP_VERSION
};

const loadedOptimization=autoOptimizeLoadedDocument();
render();
if(loadedOptimization?.changes?.length) setStatus(`自动微信约束优化：${loadedOptimization.changes.join('；')}`);
