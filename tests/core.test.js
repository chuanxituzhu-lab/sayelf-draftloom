import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInitialDocument, parseCommand, reduceDocument, VersionStore, importArticle, getLayoutGuidance, generateLayoutGuidance, humanizeText, renderDocumentBody, renderArticleHtml, renderArticlePreview, THEMES, normalizeTheme, autoFormatDocument, getWechatLayoutProfile, getWechatLayoutVariables, withCoverPreviewDraft } from '../src/core.js';
import { inspectWechatArticle } from '../src/wechat-limits.js';

test('parseCommand handles title and content commands', () => {
  assert.deepEqual(parseCommand('标题：新的标题'), { type:'setTitle', text:'新的标题' });
  assert.deepEqual(parseCommand('智能自动化优化修改执行微信公众号发布约束'), { type:'optimizeWechat' });
  assert.deepEqual(parseCommand('添加段落：正文'), { type:'appendBlock', blockType:'paragraph', text:'正文' });
  assert.deepEqual(parseCommand('一键优化排版'), { type:'autoFormat' });
  assert.equal(parseCommand('生成爆款标题').includeCover, false);
  assert.deepEqual(parseCommand('上移当前'), { type:'moveSelected', direction:-1 });
});

test('本地三维主题图作为 PNG 素材原子插入到当前段落之后', () => {
  const doc = { ...createInitialDocument(), assets: [], blocks: [
    { id: 'section', type: 'heading', text: '核心观点' },
    { id: 'paragraph', type: 'paragraph', text: '先选择一个落地场景。' },
    { id: 'next', type: 'heading', text: '下一节' }
  ] };
  const asset = { id: 'local-three-test', name: '主题图.png', type: 'image/png', dataUrl: 'data:image/png;base64,AA==', width: 900, height: 506, generated: true, source: 'draftloom:three-local' };
  const result = reduceDocument(doc, { type: 'insertGeneratedAsset', asset, afterId: 'paragraph' }, 'paragraph');
  assert.equal(result.changed, true);
  assert.equal(result.doc.assets.at(-1).source, 'draftloom:three-local');
  assert.equal(result.doc.blocks[2].assetId, asset.id);
  assert.equal(result.doc.blocks[2].source, 'draftloom:three-local');
  assert.equal(result.doc.blocks[3].id, 'next');
  const cover = reduceDocument(doc, { type: 'insertGeneratedAsset', asset: { ...asset, id: 'bad-svg', dataUrl: 'data:image/svg+xml;base64,AA==' } }, 'paragraph');
  assert.equal(cover.changed, false);
  assert.match(cover.error, /PNG/);
});

test('爆款标题只更新文章标题，不进入封面文案或封面图', () => {
  const cover = { id: 'viral-isolated-cover', name: 'cover.png', type: 'image/png', dataUrl: 'data:image/png;base64,AA==', width: 900, height: 383, coverMain: '封面主文案', coverSub: '封面副文案' };
  let doc = { ...createInitialDocument(), title: '原文章标题', assets: [cover], blocks: [
    { id: 'cover-block', type: 'image', assetId: cover.id, visualRole: 'cover', text: '封面' },
    { id: 'body-block', type: 'paragraph', text: 'AI 工具可以帮助人们解决实际问题。' }
  ] };
  const oldCoverBlock = doc.blocks.find(block => block.type === 'image');
  const result = reduceDocument(doc, { type: 'autoComposeVisuals', generate: false, maxGenerated: 0, includeCover: false, titleMode: 'viral', forceTitle: true });
  const nextCover = result.doc.assets.find(asset => asset.id === cover.id);
  assert.notEqual(result.doc.title, '原文章标题');
  assert.equal(nextCover.coverMain, '封面主文案');
  assert.equal(nextCover.coverSub, '封面副文案');
  assert.equal(nextCover.dataUrl, cover.dataUrl);
  assert.equal(result.doc.blocks.find(block => block.type === 'image').id, oldCoverBlock.id);
  const preview = renderDocumentBody(result.doc);
  assert.match(preview, /封面主文案/);
  assert.match(preview, /封面副文案/);
  const coverCopyLabel = preview.match(/<div class="wechat-cover-copy-overlay"[^>]*>/)?.[0] || '';
  assert.doesNotMatch(coverCopyLabel, new RegExp(result.doc.title));
});

test('封面文案为空时不从文章标题隐式补入', () => {
  const cover = { id: 'empty-cover-copy', name: 'cover.png', type: 'image/png', dataUrl: 'data:image/png;base64,AA==', width: 900, height: 383, coverMain: '', coverSub: '' };
  const doc = { ...createInitialDocument(), title: '文章标题不能成为封面文案', assets: [cover], blocks: [
    { id: 'empty-cover-block', type: 'image', assetId: cover.id, visualRole: 'cover', text: '封面' },
    { id: 'empty-cover-body', type: 'paragraph', text: '正文。' }
  ] };
  const preview = renderDocumentBody(doc);
  assert.doesNotMatch(preview, /wechat-cover-copy-overlay/);
});

test('reduceDocument updates title without mutating source', () => {
  const doc = createInitialDocument();
  const result = reduceDocument(doc, {type:'setTitle', text:'A'});
  assert.equal(result.doc.title, 'A');
  assert.notEqual(doc.title, 'A');
});

test('标题字号在预览与微信 HTML 中一致，并在自动排版和切换主题后保留', () => {
  const doc = { ...createInitialDocument(), title: '可调节字号的标题' };
  assert.equal(getWechatLayoutProfile(doc).titleFontSize, 26);

  const selected = reduceDocument(doc, { type: 'setTitleFontSize', fontSize: 30 });
  assert.equal(selected.changed, true);
  assert.equal(selected.doc.meta.titleFontSize, 30);
  assert.equal(doc.meta.titleFontSize, undefined);
  assert.match(getWechatLayoutVariables(selected.doc), /--wechat-title-size:30px/);
  assert.match(renderArticleHtml(selected.doc), /<h1 style="[^"]*font-size:30px/);

  const formatted = reduceDocument(selected.doc, { type: 'autoFormat' });
  const themed = reduceDocument(formatted.doc, { type: 'setTheme', theme: 'official' });
  assert.equal(getWechatLayoutProfile(themed.doc).titleFontSize, 30);
  assert.match(renderArticleHtml(themed.doc), /<h1 style="[^"]*font-size:30px/);
  assert.equal(reduceDocument(themed.doc, { type: 'setTitleFontSize', fontSize: 30 }).changed, false);
  assert.equal(reduceDocument(themed.doc, { type: 'setTitleFontSize', fontSize: 99 }).changed, false);
});

test('标题字号选择器提供明确选项并绑定文章字号设置', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(app, /id="titleFontSizeSelect" aria-label="标题字号"/);
  assert.match(app, /type:'setTitleFontSize',fontSize:Number\(e\.target\.value\)/);
  assert.match(css, /\.wechat-article h1\{font-size:var\(--wechat-title-size,26px\)/);
});

test('selected block can be moved and deleted', () => {
  const doc = createInitialDocument();
  const id = doc.blocks[1].id;
  const moved = reduceDocument(doc, {type:'moveSelected', direction:-1}, id);
  assert.equal(moved.doc.blocks[0].id, id);
  const deleted = reduceDocument(moved.doc, {type:'deleteSelected'}, id);
  assert.equal(deleted.doc.blocks.some(b=>b.id===id), false);
});

test('version store supports bounded undo/redo snapshots', () => {
  let doc = createInitialDocument();
  const versions = new VersionStore(doc, 3);
  for (const title of ['1','2','3']) {
    doc = reduceDocument(doc,{type:'setTitle',text:title}).doc;
    doc = versions.commit(doc, `set ${title}`);
  }
  assert.equal(versions.history.length, 3);
  doc = versions.undo(doc);
  assert.equal(doc.title, '2');
  doc = versions.redo(doc);
  assert.equal(doc.title, '3');
});
test('asset can be inserted into document by id', () => {
  let doc = createInitialDocument();
  const asset = {id:'a1',name:'cover.png',type:'image/png',size:1,dataUrl:'data:image/png;base64,AA==',alt:'cover'};
  doc = reduceDocument(doc,{type:'addAsset',asset}).doc;
  const result = reduceDocument(doc,{type:'insertAsset',assetId:'a1'});
  assert.equal(result.doc.blocks.at(-1).type,'image');
  assert.equal(result.doc.blocks.at(-1).assetId,'a1');
});

test('setting a new cover replaces the previous cover block and syncs the visual plan', () => {
  const oldCover = { id:'old-cover', name:'old-cover.svg', type:'image/svg+xml', size:1, width:900, height:383, dataUrl:'data:image/svg+xml,AA==', alt:'old cover' };
  const newCover = { id:'new-cover', name:'new-cover.jpg', type:'image/jpeg', size:1, width:900, height:383, dataUrl:'data:image/jpeg;base64,AA==', alt:'new cover' };
  let doc = createInitialDocument();
  doc = reduceDocument(doc, { type:'addAssets', assets:[oldCover, newCover] }).doc;
  doc = reduceDocument(doc, { type:'insertAsset', assetId:'old-cover' }).doc;
  doc.blocks[doc.blocks.length - 1].visualRole = 'cover';
  doc.meta = { ...(doc.meta || {}), visualPlan: { coverAssetId:'old-cover' } };
  const result = reduceDocument(doc, { type:'setCoverAsset', assetId:'new-cover' });
  assert.equal(result.changed, true);
  assert.equal(result.doc.blocks[0].assetId, 'new-cover');
  assert.equal(result.doc.blocks.some(block => block.visualRole === 'cover' && block.assetId === 'old-cover'), false);
  assert.equal(result.doc.meta.visualPlan.coverAssetId, 'new-cover');
});

test('smart cover adds a library asset, places it first, and keeps the summary within WeChat limits', () => {
  const doc = createInitialDocument();
  const result = reduceDocument(doc, { type: 'smartCover' });
  assert.equal(result.changed, true);
  assert.equal(result.doc.blocks[0].visualRole, 'cover');
  const cover = result.doc.assets.find(asset => asset.id === result.doc.blocks[0].assetId);
  assert.ok(cover);
  assert.equal(cover.width, 900);
  assert.equal(cover.height, 383);
  assert.ok([...result.doc.subtitle].length <= 128);
  assert.deepEqual(parseCommand('封面一键设置'), { type: 'smartCover' });
  assert.deepEqual(parseCommand('封面一键入库'), { type: 'noop' });
});

test('adding library assets appends new IDs and never overwrites an existing asset', () => {
  const doc = createInitialDocument();
  const original = { id: 'asset-1', name: '素材.png', dataUrl: 'data:image/png;base64,original' };
  doc.assets = [original];
  const incoming = [
    { id: 'asset-1', name: '素材.png', dataUrl: 'data:image/png;base64,replacement' },
    { id: 'asset-2', name: '素材.png', dataUrl: 'data:image/png;base64,another' }
  ];
  const result = reduceDocument(doc, { type: 'addAssets', assets: incoming });
  assert.equal(result.doc.assets.length, 2);
  assert.equal(result.doc.assets.find(asset => asset.id === 'asset-1').dataUrl, original.dataUrl);
  assert.equal(result.doc.assets.find(asset => asset.id === 'asset-2').dataUrl, incoming[1].dataUrl);
});

test('smart cover preserves individually human-edited summary and cover copy fields', () => {
  const cover = { id: 'stale-cover', name: '封面.png', type: 'image/png', size: 1, width: 900, height: 383, dataUrl: 'data:image/png;base64,AA==', alt: '旧封面' };
  let doc = importArticle({
    text: '# AI 写作的真正价值\n\n旧摘要不应继续沿用。\n\n真正稀缺的不是生成速度，而是判断什么值得表达。\n\n持续复盘才能让内容变得更好。',
    assets: [cover]
  });
  doc = { ...doc, subtitle: '人工旧摘要', meta: { ...doc.meta, subtitleLocked: true, subtitleSource: 'human', coverCopyLocked: true } };
  doc.assets[0].coverMain = '旧主文案';
  doc.assets[0].coverSub = '旧副文案';

  const result = reduceDocument(doc, { type: 'smartCover' });
  const refreshedCover = result.doc.assets.find(asset => asset.id === 'stale-cover');
  const coreSummary = result.doc.meta.visualPlan.coreContent.summary;

  assert.equal(result.doc.subtitle, '人工旧摘要');
  assert.equal(refreshedCover.coverMain, '旧主文案');
  assert.equal(refreshedCover.coverSub, '旧副文案');
  assert.ok([...refreshedCover.coverSub].length <= 14);
  assert.equal(result.doc.meta.subtitleLocked, true);
  assert.equal(result.doc.meta.coverMainLocked, true);
  assert.equal(result.doc.meta.coverSubLocked, true);
  assert.equal(result.doc.meta.coverCopyLocked, true);
});

test('smart cover refreshes only untouched fields and keeps cover copy distinct from summary', () => {
  let doc = importArticle({ text: '# 智能工具如何帮助创作\n\nAI 可以降低制作成本，真正稀缺的是判断和 Idea 的价值。\n\n持续执行才能获得反馈。' });
  doc = reduceDocument(doc, { type: 'smartCover' }).doc;
  const coverBefore = doc.assets.find(asset => asset.id === doc.blocks[0].assetId);
  doc = reduceDocument(doc, { type: 'setCoverCopy', field: 'main', main: '人工主标题', sub: coverBefore.coverSub }).doc;
  doc = reduceDocument(doc, { type: 'setSubtitle', text: '人工摘要单独保留' }).doc;
  const result = reduceDocument(doc, { type: 'generateTitleImage' });
  const cover = result.doc.assets.find(asset => asset.id === result.doc.blocks[0].assetId);
  assert.equal(result.doc.subtitle, '人工摘要单独保留');
  assert.equal(cover.coverMain, '人工主标题');
  assert.equal(result.doc.meta.coverMainLocked, true);
  assert.equal(result.doc.meta.coverSubLocked, false);
  assert.notEqual(cover.coverSub.replace(/…$/, '').replace(/\s+/g, ''), result.doc.subtitle.replace(/\s+/g, ''));
});

test('title image generation and WeChat optimization never overwrite any manually locked copy', () => {
  let doc = importArticle({ text: '# 自动化标题\n\n智能工具能够降低重复劳动，作者仍需判断什么值得表达。'.repeat(8) });
  doc = reduceDocument(doc, { type: 'smartCover' }).doc;
  const cover = doc.assets.find(asset => asset.id === doc.blocks[0].assetId);
  doc = reduceDocument(doc, { type: 'setCoverCopy', field: 'sub', main: cover.coverMain, sub: '人工副文案' }).doc;
  doc = reduceDocument(doc, { type: 'setSubtitle', text: '人工摘要优先' }).doc;
  const editedCover = doc.assets.find(asset => asset.id === doc.blocks[0].assetId);
  const generated = reduceDocument(doc, { type: 'generateTitleImage' }).doc;
  const regeneratedCover = generated.assets.find(asset => asset.id === generated.blocks[0].assetId);
  assert.equal(generated.subtitle, '人工摘要优先');
  assert.equal(regeneratedCover.coverSub, '人工副文案');
  assert.equal(regeneratedCover.dataUrl, editedCover.dataUrl);
  assert.ok(decodeURIComponent(regeneratedCover.dataUrl).includes('人工副文案'));
  const optimized = reduceDocument(generated, { type: 'optimizeWechat' }).doc;
  assert.equal(optimized.subtitle, '人工摘要优先');
  assert.equal(optimized.assets.find(asset => asset.id === optimized.blocks[0].assetId).coverSub, '人工副文案');
});

test('人工输入的封面副文案即使与摘要相同也照常显示', () => {
  let doc = importArticle({ text: '# 标题\n\n一段足够清楚的文章正文，用于测试封面副文案与摘要的显示优先级。' });
  doc = reduceDocument(doc, { type: 'smartCover' }).doc;
  doc = reduceDocument(doc, { type: 'setSubtitle', text: '共同文案' }).doc;
  const cover = doc.assets.find(asset => asset.id === doc.blocks[0].assetId);
  doc = reduceDocument(doc, { type: 'setCoverCopy', field: 'sub', main: cover.coverMain, sub: '共同文案' }).doc;
  const preview = renderDocumentBody(doc);
  const coverAsset = doc.assets.find(asset => asset.id === doc.blocks[0].assetId);
  assert.ok(decodeURIComponent(coverAsset.dataUrl).includes('共同文案'));
  assert.doesNotMatch(preview, /wechat-cover-copy-overlay/);
});

test('封面字段实时预览覆盖在封面图上，发布 HTML 不在封面下方重复展示', () => {
  const cover = { id: 'cover-copy-preview', name: '封面.png', type: 'image/png', dataUrl: 'data:image/png;base64,AA==', width: 900, height: 383, coverMain: '旧主文案', coverSub: '旧副文案' };
  const doc = importArticle({ text: '# 文章标题\n\n文章正文内容。', assets: [cover] });
  const previewCover = { ...cover, coverMain: '当前主文案', coverSub: '当前副文案' };
  const previewDoc = { ...doc, assets: doc.assets.map(asset => asset.id === cover.id ? previewCover : asset) };
  const preview = renderDocumentBody(previewDoc);
  const html = renderArticleHtml(previewDoc);
  assert.match(preview, /wechat-cover-copy-overlay[\s\S]*当前主文案[\s\S]*当前副文案/);
  assert.doesNotMatch(preview, /<figcaption class="wechat-cover-copy"/);
  assert.doesNotMatch(html, /当前主文案|当前副文案|<figcaption[^>]*>[^<]*<strong/);
  assert.match(html, /data-wechat-cover="true"/);
  const coverFigureStyle = html.match(/<figure style="([^"]*)" data-wechat-cover="true"/)?.[1] || '';
  const coverImageStyle = html.match(/<figure style="[^"]*" data-wechat-cover="true"><img style="([^"]*)"/)?.[1] || '';
  assert.match(coverFigureStyle, /width:100%;max-width:100%;box-sizing:border-box;margin:0 auto 24px/);
  assert.doesNotMatch(coverFigureStyle, /margin:-/);
  assert.match(coverImageStyle, /display:block;width:100%;max-width:100%;height:auto;margin:0 auto;object-fit:contain;object-position:center center/);
});

test('WebUI 封面预览与导出一致：在正文列内居中且不再负边距通栏', async () => {
  const css = await readFile(new URL('../src/theme.css', import.meta.url), 'utf8');
  const coverRule = css.match(/\.shell \.wechat-cover\s*\{([^}]*)\}/)?.[1] || '';
  const coverImageRule = css.match(/\.shell \.wechat-cover:not\(\.wechat-cover-placeholder\)\s*>\s*img\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(coverRule, /width:100%/);
  assert.match(coverRule, /margin:0 auto 20px/);
  assert.doesNotMatch(coverRule, /margin:-/);
  assert.match(coverImageRule, /object-fit:contain/);
  assert.match(coverImageRule, /object-position:center center/);
  assert.match(coverImageRule, /margin:0 auto/);
});

test('预览和微信 HTML 自动省略开头重复标题及复述摘要的短段落，但不删原稿', () => {
  const title = '欢迎来到 SAYELF 背后藏着一个被忽略的规律';
  const titleEcho = '原来，欢迎来到 SAYELF 背后藏着一个被忽略的规律';
  const summaryEcho = 'SAYELF 山野精灵探索 AI · 创造工具 · 重构工作与生活';
  const doc = {
    ...createInitialDocument(),
    title,
    subtitle: 'SAYELF 山野精灵，探索 AI、Agent、自动化工作流与数字工具创造。从认识 AI 到创造自己的工具，用真实实践，让技术成为每个人的创造力。',
    blocks: [
      { id: 'echo-title', type: 'heading', level: 2, text: titleEcho },
      { id: 'echo-summary', type: 'paragraph', text: summaryEcho },
      { id: 'real-opening', type: 'paragraph', text: '文章接下来会讲清楚具体经历、方法和判断依据。' },
      { id: 'real-heading', type: 'heading', level: 2, text: '01 先说结论' }
    ]
  };
  const preview = renderDocumentBody(doc);
  const html = renderArticleHtml(doc);
  for (const output of [preview, html]) {
    const visibleText = output.replace(/<[^>]*>/g, '');
    assert.doesNotMatch(output, /原来，欢迎来到 SAYELF/);
    assert.doesNotMatch(visibleText, /SAYELF 山野精灵探索 AI · 创造工具/);
    assert.match(visibleText, /文章接下来会讲清楚具体经历/);
    assert.match(visibleText, /01 先说结论/);
  }
  assert.equal(doc.blocks.length, 4);
  assert.equal(doc.blocks[0].text, titleEcho);
  assert.equal(doc.blocks[1].text, summaryEcho);

  const standaloneSummaryEcho = renderArticleHtml({
    ...doc,
    blocks: [
      { id: 'unrelated-heading', type: 'heading', level: 2, text: '第一章：文章背景' },
      { id: 'kept-summary-like-paragraph', type: 'paragraph', text: summaryEcho }
    ]
  });
  assert.match(standaloneSummaryEcho.replace(/<[^>]*>/g, ''), /SAYELF 山野精灵探索 AI · 创造工具/);
});

test('manual cover fields remain independent across optimization and cover replacement', () => {
  let doc = importArticle({ text: '# 本地创作工具\n\n本地创作工具可以帮助作者保持稳定的表达节奏。\n\n文章排版也要让手机阅读更加舒适。' });
  doc = reduceDocument(doc, { type: 'smartCover' }).doc;
  const oldCover = doc.assets.find(asset => asset.id === doc.blocks[0].assetId);
  doc = reduceDocument(doc, { type: 'setCoverCopy', field: 'sub', main: oldCover.coverMain, sub: '人工副标题' }).doc;
  const other = { id: 'replacement-cover', name: '人工素材', type: 'image/png', dataUrl: 'data:image/png;base64,AA==', width: 900, height: 383 };
  doc = reduceDocument(doc, { type: 'addAssets', assets: [other] }).doc;
  doc = reduceDocument(doc, { type: 'setCoverAsset', assetId: other.id }).doc;
  let currentCover = doc.assets.find(asset => asset.id === other.id);
  assert.equal(currentCover.coverSub, '人工副标题');
  const optimized = reduceDocument(doc, { type: 'optimizeWechat' });
  currentCover = optimized.doc.assets.find(asset => asset.id === other.id);
  assert.equal(currentCover.coverSub, '人工副标题');
  assert.equal(optimized.doc.meta.coverSubLocked, true);
  assert.equal(optimized.doc.meta.coverMainLocked, false);
});

test('title image action extracts core content without replacing the current title', () => {
  const doc = importArticle({ text: '# 人工确认标题\n\nAI 可以降低制作成本，但真正稀缺的是 Idea 的价值。\n\n持续执行才能获得反馈。' });
  const result = reduceDocument(doc, { type: 'generateTitleImage' });
  assert.equal(result.changed, true);
  assert.equal(result.doc.title, '人工确认标题');
  assert.match(result.doc.meta.visualPlan.coreContent.summary, /真正稀缺的是 Idea/);
  assert.equal(result.doc.blocks[0].visualRole, 'cover');
  const cover = result.doc.assets.find(asset => asset.id === result.doc.blocks[0].assetId);
  assert.equal(cover.generated, true);
  assert.equal(cover.width, 900);
  assert.equal(cover.height, 383);
  assert.match(cover.coverSub, /^AI 可以降低/);
  assert.deepEqual(parseCommand('提炼核心并生成标题图'), { type: 'generateTitleImage' });
});

test('cover copy can be edited in the dedicated cover settings and stays locked until smart reset', () => {
  let doc = createInitialDocument();
  doc = reduceDocument(doc, { type: 'smartCover' }).doc;
  const coverId = doc.blocks[0].assetId;
  const edited = reduceDocument(doc, { type: 'setCoverCopy', main: '手工封面', sub: '编辑摘要' });
  assert.equal(edited.changed, true);
  assert.equal(edited.doc.assets.find(asset => asset.id === coverId).coverMain, '手工封面');
  assert.equal(edited.doc.meta.coverCopyLocked, true);
  const optimized = reduceDocument(edited.doc, { type: 'optimizeWechat' });
  assert.equal(optimized.doc.assets.find(asset => asset.id === coverId).coverMain, '手工封面');
});

test('微信智能优化蒸馏正文、生成系列建议并保留原稿', () => {
  let doc = createInitialDocument();
  doc.title = '超长标题'.repeat(8);
  doc.author = '作者'.repeat(12);
  doc.subtitle = '摘要内容。'.repeat(40);
  doc.blocks[1].text = '正文内容。'.repeat(6000);
  const originalBody = doc.blocks[1].text;
  const result = reduceDocument(doc, { type: 'optimizeWechat' });
  assert.equal(result.changed, true);
  assert.ok([...result.doc.title].length <= 32);
  assert.ok([...result.doc.author].length <= 16);
  assert.ok([...result.doc.subtitle].length <= 128);
  assert.notEqual(result.doc.blocks[1].text, originalBody);
  assert.ok(result.doc.blocks[1].text.length < originalBody.length);
  assert.equal(result.doc.meta.wechatOptimization.protectedOriginalBody[1].text, originalBody);
  assert.ok(result.doc.meta.wechatOptimization.distilled.changed);
  assert.equal(result.optimization.validation.ok, true);
  assert.ok(result.doc.meta.wechatOptimization.seriesPlan);
  assert.match(result.doc.meta.wechatOptimization.changes.join('；'), /系列拆分/);
});

test('微信智能检测会合并短段落以压缩重复 HTML，同时保留原稿', () => {
  const doc = createInitialDocument();
  const originalBlocks = Array.from({ length: 400 }, (_, index) => ({ id: `short-${index}`, type: 'paragraph', text: `第${index + 1}段：这是导入后的短段落。` }));
  const working = { ...doc, title: '短段落文章', blocks: originalBlocks };
  const result = reduceDocument(working, { type: 'optimizeWechat' });
  const validation = inspectWechatArticle({ content: renderArticleHtml(result.doc) });
  assert.equal(validation.ok, true);
  assert.ok(result.doc.blocks.length < originalBlocks.length);
  assert.equal(result.doc.meta.wechatOptimization.protectedOriginalBody.length, originalBlocks.length);
});

test('智能优化同步封面文案，并在预览中单独显示封面与内容摘要位置', () => {
  const cover = { id: 'cover-preview', name: '封面.png', type: 'image/png', size: 1, width: 900, height: 383, dataUrl: 'data:image/png;base64,AA==', alt: '山野封面' };
  let doc = importArticle({ text: '# 山野茶的慢生活\n\n这里是一段用于验证摘要位置的正文内容。', assets: [cover] });
  doc = { ...doc, title: '山野茶的慢生活', subtitle: '一段关于自然、茶与日常节奏的内容摘要。' };
  const result = reduceDocument(doc, { type: 'optimizeWechat' });
  const coverAsset = result.doc.assets.find(asset => asset.id === 'cover-preview');
  const preview = renderDocumentBody(result.doc);
  const html = renderArticleHtml(result.doc);
  assert.equal(result.changed, true);
  assert.equal(coverAsset.coverMain, '山野茶的慢生活');
  assert.ok([...coverAsset.coverSub].length <= 14);
  assert.match(coverAsset.coverSub, /^这里是一段/);
  assert.match(preview, /data-wechat-cover="true"/);
  assert.match(preview, /data-wechat-summary="true"/);
  assert.match(html, /data-wechat-cover="true"/);
  assert.match(html, /内容摘要/);
  assert.equal((preview.match(/src="data:image\/png/g) || []).length, 1);
  assert.equal((preview.match(/封面/g) || []).length >= 1, true);
});

test('没有封面素材时，手工编辑摘要仍即时进入右侧文章预览', () => {
  const doc = { ...importArticle({ text: '# 没有封面的文章\n\n正文内容。' }), assets: [] };
  const originalSummary = doc.subtitle;
  const previewDoc = withCoverPreviewDraft(doc, { summary: '正在编辑中的人工摘要' });
  const preview = renderDocumentBody(previewDoc);
  assert.match(preview, /正在编辑中的人工摘要/);
  assert.equal(doc.subtitle, originalSummary);
  assert.match(preview, /wechat-cover-placeholder/);
});

test('微信 HTML keeps many short paragraphs below the API character limit without deleting visible text', () => {
  const doc = createInitialDocument();
  const blocks = Array.from({ length: 140 }, (_, index) => ({
    id: `short-${index}`,
    type: 'paragraph',
    text: `第${index + 1}段：普通人也能用AI完成一件真实的事。`
  }));
  const article = { ...doc, title: 'AI平权', subtitle: '约两千字的短文', blocks };
  const html = renderArticleHtml(article);
  const validation = inspectWechatArticle({ title: article.title, digest: article.subtitle, content: html });
  assert.equal(blocks.reduce((sum, block) => sum + [...block.text].length, 0) < 20_000, true);
  assert.equal(validation.ok, true);
  const visibleText = html.replace(/<[^>]*>/g, '');
  assert.ok(blocks.every(block => visibleText.includes(block.text)));
  assert.match(html, /font-family:/);
  assert.match(html, /line-height:/);
});

test('文章预览和微信 HTML 在正文末尾罗列自动关键词标签', () => {
  const doc = importArticle({ text: '# AI 内容创作\n\nAI 可以降低内容创作成本，持续执行才能获得反馈。' });
  const preview = renderDocumentBody(doc);
  const html = renderArticleHtml(doc);
  assert.match(preview, /data-article-hashtags="true"/);
  assert.match(preview, /#AI/);
  assert.doesNotMatch(preview, /关键词标签/);
  assert.match(html, /data-article-hashtags="true"/);
  assert.match(html, /#AI/);
  assert.doesNotMatch(html, /关键词标签/);
});

test('asset library supports batch upload and replacing the selected image', () => {
  let doc = createInitialDocument();
  const first = {id:'a1',name:'first.png',type:'image/png',size:1,dataUrl:'data:image/png;base64,AA==',alt:'first'};
  const second = {id:'a2',name:'second.png',type:'image/png',size:1,dataUrl:'data:image/png;base64,AA==',alt:'second'};
  doc = reduceDocument(doc,{type:'addAssets',assets:[first,second]}).doc;
  const inserted = reduceDocument(doc,{type:'insertAsset',assetId:'a1'});
  const imageId = inserted.doc.blocks.at(-1).id;
  const replaced = reduceDocument(inserted.doc,{type:'replaceSelectedAsset',assetId:'a2'},imageId);
  assert.equal(replaced.doc.blocks.at(-1).assetId,'a2');
  assert.equal(replaced.doc.blocks.at(-1).text,'second');
  assert.deepEqual(parseCommand('替换当前图片：second'),{type:'replaceSelectedAssetByName',name:'second'});
});

test('asset deletion removes article references and the library item', () => {
  let doc = createInitialDocument();
  const asset = {id:'used',name:'used.png',type:'image/png',size:1,dataUrl:'data:image/png;base64,AA==',alt:'used'};
  const spare = {id:'spare',name:'spare.png',type:'image/png',size:1,dataUrl:'data:image/png;base64,AA==',alt:'spare'};
  doc = reduceDocument(doc,{type:'addAssets',assets:[asset,spare]}).doc;
  const inserted = reduceDocument(doc,{type:'insertAsset',assetId:'used'});
  const deleted = reduceDocument(inserted.doc,{type:'deleteAsset',assetId:'used'});
  assert.equal(deleted.changed,true);
  assert.equal(deleted.doc.assets.some(item=>item.id==='used'),false);
  assert.equal(deleted.doc.blocks.some(block=>block.assetId==='used'),false);
  assert.equal(deleted.doc.assets.some(item=>item.id==='spare'),true);

  const galleryDoc = reduceDocument(inserted.doc,{type:'appendBlock',blockType:'gallery',assetIds:['used','spare']}).doc;
  const galleryDeleted = reduceDocument(galleryDoc,{type:'deleteAsset',assetId:'used'});
  const gallery = galleryDeleted.doc.blocks.find(block=>block.type==='gallery');
  assert.deepEqual(gallery?.assetIds,['spare']);
});

test('article import creates semantic blocks and matches referenced images', () => {
  const cover = { id:'cover-1', name:'cover.png', type:'image/png', size:1, dataUrl:'data:image/png;base64,AA==', alt:'封面' };
  const doc = importArticle({
    filename: 'article.md',
    text: '# 自动排版标题\n\n## 第一节\n\n这是正文。\n\n![封面](cover.png)\n\n> 一句引用。',
    assets: [cover]
  });
  assert.equal(doc.title, '自动排版标题');
  assert.equal(doc.original.filename, 'article.md');
  assert.deepEqual(doc.blocks.map(block => block.type), ['heading', 'paragraph', 'image', 'quote']);
  assert.equal(doc.blocks[2].assetId, 'cover-1');
  assert.equal(doc.meta.importWarnings.length, 0);
});

test('layout guidance flags long text for human review', () => {
  const doc = importArticle({ text: `文章标题\n\n${'很长的正文。'.repeat(50)}` });
  const guidance = getLayoutGuidance(doc);
  assert.equal(guidance.some(item => item.text.includes('长段落')), true);
});

test('one-click layout guidance groups local recommendations and keeps commands', () => {
  const doc = importArticle({ text: '自动排版指导测试\n\n第一段内容，介绍文章背景和问题。\n\n第二段内容，说明解决方法和执行过程。\n\n第三段内容，总结最终结论和下一步建议。' });
  const before = JSON.stringify(doc);
  const report = generateLayoutGuidance(doc);
  assert.deepEqual(report.sections.map(section => section.key), ['hierarchy', 'images', 'titles', 'recommendations']);
  assert.ok(report.sections.find(section => section.key === 'hierarchy').items.some(item => item.command.includes('改成标题')));
  assert.ok(report.sections.find(section => section.key === 'images').items.length >= 1);
  assert.ok(report.sections.find(section => section.key === 'titles').items.length >= 1);
  assert.ok(report.sections.find(section => section.key === 'titles').items.every(item => item.command.startsWith('标题：') && item.text.includes('正文依据')));
  assert.equal(JSON.stringify(doc), before);
});

test('layout guidance ignores legacy or stale title candidates and rebuilds from current body evidence', () => {
  const doc = importArticle({ text: '当前正文\n\n当前正文的核心结论是先核实事实，再据此给出行动建议。\n\n这句话补充文章的实际背景和适用范围。\n\n最后说明可以如何开始执行。' });
  doc.meta.titlePlan = { mode: 'viral', applied: true, candidates: [{ title: '虚构的爆款标题', rationale: '没有正文依据' }] };
  const titleItems = generateLayoutGuidance(doc).sections.find(section => section.key === 'titles').items;
  assert.ok(titleItems.length > 0);
  assert.ok(titleItems.every(item => !item.text.includes('虚构的爆款标题')));
  assert.ok(titleItems.every(item => item.text.includes('正文依据')));
});

test('natural language supports component creation and conversion', () => {
  assert.deepEqual(parseCommand('添加列表：甲；乙'), { type: 'appendBlock', blockType: 'list', text: '甲；乙', items: ['甲', '乙'], ordered: false });
  assert.equal(parseCommand('添加表格：A|B\n1|2').blockType, 'table');
  assert.deepEqual(parseCommand('把当前改成引用'), { type: 'convertSelected', blockType: 'quote', text: undefined });
  assert.equal(parseCommand('第 3 段改成标题：关键结论').index, 2);
  assert.deepEqual(parseCommand('主题：杂志'), { type: 'setTheme', theme: 'editorial' });
  assert.deepEqual(parseCommand('主题：墨韵'), { type: 'setTheme', theme: 'ink' });
  assert.deepEqual(parseCommand('去 AI 味：保守'), { type: 'humanize', mode: 'conservative' });
});

test('theme catalog contains six distinct workspace themes', () => {
  assert.deepEqual(Object.keys(THEMES), ['minimal', 'editorial', 'fresh', 'ink', 'sunset', 'official']);
  assert.equal(normalizeTheme('暖阳'), 'sunset');
  const minimal = renderArticleHtml({ ...createInitialDocument(), theme: 'minimal' });
  const sunset = renderArticleHtml({ ...createInitialDocument(), theme: 'sunset' });
  assert.notEqual(minimal, sunset);
  assert.match(sunset, /#e45f3f/);
});

test('微信官方深色主题复用官方参考中的深底、绿色锚点和图片留边规则', () => {
  const doc = {
    ...createInitialDocument(),
    theme: 'official',
    title: '统一视觉系统',
    subtitle: '让重点自然浮现',
    blocks: [
      { id: 'section', type: 'heading', level: 2, text: '01 先建立阅读层级' },
      { id: 'subsection', type: 'heading', level: 3, text: '绿色视觉锚点' },
      { id: 'body', type: 'paragraph', text: '正文只保留必要的阅读信息。', emphasisRanges: [{ start: 0, end: 4, style: 'mark' }] },
      { id: 'image', type: 'image', assetId: 'visual', text: '章节配图', visualRole: 'section' }
    ],
    assets: [
      { id: 'cover', name: 'cover.jpg', type: 'image/jpeg', size: 1, width: 900, height: 383, dataUrl: 'data:image/jpeg;base64,AA==', alt: '封面' },
      { id: 'visual', name: 'visual.jpg', type: 'image/jpeg', size: 1, width: 900, height: 506, dataUrl: 'data:image/jpeg;base64,AA==', alt: '章节配图' }
    ]
  };
  doc.blocks.unshift({ id: 'cover-block', type: 'image', assetId: 'cover', text: '封面', visualRole: 'cover' });
  const profile = getWechatLayoutProfile(doc);
  const html = renderArticleHtml(doc);
  assert.equal(normalizeTheme('微信官方深色'), 'official');
  assert.equal(profile.imageMaxWidth, 88);
  assert.equal(profile.titleAlign, 'left');
  assert.match(html, /background:#121413/);
  assert.match(html, /text-align:left/);
  assert.match(html, /max-width:88%;height:auto/);
  assert.match(html, /background:#222725;border:1px solid #3a433e;border-radius:8px/);
  assert.match(html, /<h3 style="[^"]*color:#19d875/);
  assert.match(html, /rgba\(25,216,117,.16\)/);
  assert.match(html, /border-bottom:1px solid #19d875/);

  const previouslyFormatted = autoFormatDocument({ ...doc, theme: 'minimal' }).doc;
  const switched = autoFormatDocument({ ...previouslyFormatted, theme: 'official' }).doc;
  assert.equal(switched.meta.layoutProfile.themeId, 'official');
  assert.equal(switched.meta.layoutProfile.imageMaxWidth, 88);
  assert.equal(switched.meta.layoutProfile.titleAlign, 'left');
});

test('一键优化公众号排版会统一字体节奏并保留局部重点标注', () => {
  const doc = {
    ...createInitialDocument(),
    title: '排版优化测试',
    blocks: [
      { id: 'label', type: 'paragraph', text: '一、先建立阅读层级' },
      { id: 'body', type: 'paragraph', text: '  重点：这是需要读者记住的核心结论。  这是一段较长的正文，用来验证自动排版会依据句子边界拆分段落并保持手机端的阅读节奏。  第二个句子继续补充背景，避免一整屏都是密集文字。  文章还需要给出执行方法、判断标准和复盘路径，让读者读完之后知道下一步应该如何行动。  最后还要给出复盘方法，让内容从观点落到行动，并且让读者能在下一次阅读时快速找到重点。' },
      { id: 'quote', type: 'quote', text: '“好的排版应该让重点自然浮现，而不是把所有内容都涂成重点。”' }
    ]
  };
  const result = reduceDocument(doc, { type: 'autoFormat' });
  assert.equal(result.changed, true);
  assert.ok(result.doc.blocks.some(block => block.type === 'heading' && block.text.includes('先建立')));
  assert.ok(result.doc.blocks.filter(block => block.type === 'paragraph').length >= 2);
  assert.equal(result.doc.meta.layoutMode, 'auto');
  assert.deepEqual(getWechatLayoutProfile(result.doc), result.doc.meta.layoutProfile);
  const emphasized = result.doc.blocks.find(block => block.id === 'body');
  assert.ok(emphasized.emphasisRanges.some(range => range.style === 'mark'));
  assert.ok(emphasized.emphasisRanges.every(range => range.end - range.start < emphasized.text.length));
  const html = renderArticleHtml(result.doc);
  assert.match(html, /font-family:/);
  assert.match(html, /margin:18px 0/);
  assert.match(html, /<span style="background:#fff1cf;color:#303a43;font-weight:700/);
  assert.doesNotMatch(html, /<mark\b/);
  assert.match(renderDocumentBody(result.doc), /<mark class="inline-emphasis">/);
  const darkHtml = renderArticleHtml({ ...result.doc, theme: 'official' });
  assert.match(darkHtml, /<span style="background:rgba\(25,216,117,\.16\);color:#19d875;font-weight:700/);
  const repeat = reduceDocument(result.doc, { type: 'autoFormat' });
  assert.equal(repeat.changed, false);
  assert.ok(autoFormatDocument(result.doc).stats.highlightedRanges >= 1);
});

test('一键排版会把相邻配图拆开，并用正文区块形成阅读间隔', () => {
  const doc = createInitialDocument();
  doc.blocks = [
    { id: 'text-1', type: 'paragraph', text: '第一段正文提供足够的信息，让图片之间保持清晰的阅读节奏。' },
    { id: 'image-1', type: 'image', assetId: 'asset-1' },
    { id: 'image-2', type: 'image', assetId: 'asset-2' },
    { id: 'text-2', type: 'paragraph', text: '第二段正文补充说明图片主题，并让阅读顺序自然衔接。' }
  ];
  const result = autoFormatDocument(doc);
  const imageIndexes = result.doc.blocks.map((block, index) => block.type === 'image' ? index : -1).filter(index => index >= 0);
  assert.equal(imageIndexes.length, 2);
  assert.equal(result.doc.blocks[imageIndexes[1] - 1].type, 'paragraph');
  assert.deepEqual(result.doc.blocks.filter(block => block.type !== 'image').map(block => block.id), ['text-1', 'text-2']);
  assert.ok(result.changes.some(change => change.includes('相邻配图')));
});

test('相邻图片不能越过新章节标题迁移', () => {
  const doc = createInitialDocument();
  doc.blocks = [
    { id: 'section-one', type: 'heading', text: '第一章', level: 2 },
    { id: 'body-one', type: 'paragraph', text: '第一章正文有足够长度，可以用于解释当前章节的主要观点。' },
    { id: 'image-one', type: 'image', assetId: 'asset-1' },
    { id: 'image-two', type: 'image', assetId: 'asset-2' },
    { id: 'section-two', type: 'heading', text: '第二章', level: 2 },
    { id: 'body-two', type: 'paragraph', text: '第二章正文说明另外一个主题，不应被移动到第一章图片之间。' }
  ];
  const result = autoFormatDocument(doc);
  assert.deepEqual(result.doc.blocks.map(block => block.id), doc.blocks.map(block => block.id));
  assert.ok(result.changes.some(change => change.includes('避免跨章移动')));
});

test('三张连续图片只按本章可用正文分配间隔并准确报告剩余图片对', () => {
  const doc = createInitialDocument();
  doc.blocks = [
    { id: 'section-one', type: 'heading', text: '第一章', level: 2 },
    { id: 'image-one', type: 'image', assetId: 'asset-1' },
    { id: 'image-two', type: 'image', assetId: 'asset-2' },
    { id: 'image-three', type: 'image', assetId: 'asset-3' },
    { id: 'body-one', type: 'paragraph', text: '第一段正文足够长，可以作为第一张图片与后续图片之间的自然间隔。' },
    { id: 'body-two', type: 'paragraph', text: '第二段正文继续补充信息，可以作为后续图片之间的另一个阅读间隔。' },
    { id: 'section-two', type: 'heading', text: '第二章', level: 2 },
    { id: 'body-three', type: 'paragraph', text: '第二章正文不应被移动到第一章中。' }
  ];
  const result = autoFormatDocument(doc);
  const imageIds = result.doc.blocks.filter(block => block.type === 'image').map(block => block.id);
  assert.deepEqual(imageIds, ['image-one', 'image-two', 'image-three']);
  assert.equal(result.doc.blocks.some((block, index) => block.type === 'image' && result.doc.blocks[index + 1]?.type === 'image'), false);
  assert.deepEqual(result.doc.blocks.filter(block => block.type !== 'image').map(block => block.id), doc.blocks.filter(block => block.type !== 'image').map(block => block.id));

  const limited = createInitialDocument();
  limited.blocks = [
    { id: 'section', type: 'heading', text: '一章', level: 2 },
    { id: 'a', type: 'image', assetId: 'a' },
    { id: 'b', type: 'image', assetId: 'b' },
    { id: 'c', type: 'image', assetId: 'c' },
    { id: 'only-body', type: 'paragraph', text: '本章只有这一段正文内容可以作为间隔，因此不应跨过章节边界借用下一章文字。' },
    { id: 'next-section', type: 'heading', text: '二章', level: 2 },
    { id: 'next-body', type: 'paragraph', text: '不可跨入下一章借用正文作为间隔。' }
  ];
  const limitedResult = autoFormatDocument(limited);
  assert.ok(limitedResult.changes.some(change => change.includes('仍有 1 对相邻配图无法分隔')));
  assert.ok(limitedResult.doc.blocks.findIndex(block => block.id === 'c') < limitedResult.doc.blocks.findIndex(block => block.id === 'next-section'));
});
test('import creates list, table and CTA semantic blocks', () => {
  const doc = importArticle({ text: '# 标题\n\n- 甲\n- 乙\n\n|列A|列B|\n|---|---|\n|值1|值2|\n\n:::cta\ntext: 继续阅读\nbutton: 打开\n:::' });
  assert.deepEqual(doc.blocks.map(block => block.type), ['list', 'table', 'cta']);
  assert.deepEqual(doc.blocks[0].items, ['甲', '乙']);
  assert.deepEqual(doc.blocks[1].headers, ['列A', '列B']);
  assert.equal(doc.blocks[2].buttonText, '打开');
});

test('humanizer and split intents preserve a reversible document shape', () => {
  let doc = createInitialDocument();
  const paragraphId = doc.blocks[1].id;
  doc = reduceDocument(doc, { type: 'updateBlock', id: paragraphId, text: '众所周知，我们可以看到很多内容。第二句也应该保留。' }).doc;
  const natural = reduceDocument(doc, { type: 'humanize', mode: 'natural' });
  assert.equal(natural.doc.blocks[1].text.includes('众所周知'), false);
  const split = reduceDocument(natural.doc, { type: 'splitSelected' }, paragraphId);
  assert.equal(split.changed, true);
  assert.equal(split.doc.blocks.filter(block => block.type === 'paragraph').length >= 2, true);
  assert.match(renderArticleHtml({ ...split.doc, theme: 'fresh' }), /theme|wechat-article/);
  assert.equal(humanizeText('  文本  ', 'conservative'), '文本');
});

test('微信草稿 HTML uses inline styles for compatibility', () => {
  const html = renderArticleHtml(createInitialDocument());
  assert.equal(html.includes('<style>'), false);
  assert.equal(html.includes('style="'), true);
  assert.match(html, /class="wechat-article"/);
});

test('微信排版对图片居中自适应并避免重复长图注', () => {
  const longDescription = '这是一段自动匹配图片时产生的长正文说明，不应在图片下方再次完整占据阅读空间。';
  const cover = { id: 'cover', name: 'cover.jpg', type: 'image/jpeg', size: 1, width: 900, height: 383, dataUrl: 'data:image/jpeg;base64,AA==', alt: '文章封面' };
  const asset = { id: 'scene', name: 'scene.jpg', type: 'image/jpeg', size: 1, width: 900, height: 506, dataUrl: 'data:image/jpeg;base64,AA==', alt: '奥德赛归来' };
  const doc = {
    ...createInitialDocument(),
    title: '奥德赛归来',
    blocks: [
      { id: 'cover-block', type: 'image', assetId: 'cover', text: '文章封面', visualRole: 'cover' },
      { id: 'intro', type: 'paragraph', text: '文章正文。' },
      { id: 'scene-block', type: 'image', assetId: 'scene', text: longDescription, visualRole: 'section', generatedBy: 'autoComposeVisuals' }
    ],
    assets: [cover, asset]
  };
  const preview = renderDocumentBody(doc);
  const html = renderArticleHtml(doc);
  assert.match(preview, /class="wechat-image-figure"/);
  assert.match(preview, /正文配图 01/);
  assert.doesNotMatch(preview, new RegExp(longDescription));
  assert.match(html, /data-w="900" data-h="506" data-type="jpeg"/);
  assert.match(html, /width:100%;max-width:100%;height:auto/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /font-family:/);
  assert.match(renderArticleHtml({ ...doc, blocks: [{ id: 'subheading', type: 'heading', level: 3, text: '归来的意义' }] }), /<h3 style=/);
});

test('微信实时预览直接复用发布 HTML 的完整 article 片段', async () => {
  const doc = {
    ...createInitialDocument(),
    title: '实时预览与发布一致',
    subtitle: '预览复用最终发布片段。',
    theme: 'official',
    blocks: [
      { id: 'opening', type: 'paragraph', text: '这是一篇没有显式重点词的普通文章。读者需要一眼看见核心结论，才能快速理解内容。' },
      { id: 'section', type: 'heading', level: 2, text: '01 核心结论' }
    ]
  };
  const html = renderArticleHtml(doc);
  const article = html.slice(html.indexOf('<article class="wechat-article"'), html.lastIndexOf('</article>') + '</article>'.length);
  assert.equal(renderArticlePreview(doc), article);
  assert.match(article, /<span style="background:rgba\(25,216,117,\.16\);color:#19d875/);
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.wechat-preview-scale>\.wechat-article\{min-height:0!important;border:0!important;box-shadow:none!important/);
  assert.match(css, /\.wechat-preview-scale>\.wechat-article p\{font-size:inherit!important;color:inherit!important;line-height:inherit!important;text-align:inherit!important\}/);
});
