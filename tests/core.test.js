import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialDocument, parseCommand, reduceDocument, VersionStore, importArticle, getLayoutGuidance, humanizeText, renderDocumentBody, renderArticleHtml, THEMES, normalizeTheme } from '../src/core.js';
import { inspectWechatArticle } from '../src/wechat-limits.js';

test('parseCommand handles title and content commands', () => {
  assert.deepEqual(parseCommand('标题：新的标题'), { type:'setTitle', text:'新的标题' });
  assert.deepEqual(parseCommand('智能自动化优化修改执行微信公众号发布约束'), { type:'optimizeWechat' });
  assert.deepEqual(parseCommand('添加段落：正文'), { type:'appendBlock', blockType:'paragraph', text:'正文' });
  assert.deepEqual(parseCommand('上移当前'), { type:'moveSelected', direction:-1 });
});

test('reduceDocument updates title without mutating source', () => {
  const doc = createInitialDocument();
  const result = reduceDocument(doc, {type:'setTitle', text:'A'});
  assert.equal(result.doc.title, 'A');
  assert.notEqual(doc.title, 'A');
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
  assert.equal((preview.match(/data:image/g) || []).length, 1);
  assert.equal((preview.match(/封面/g) || []).length >= 1, true);
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

test('natural language supports component creation and conversion', () => {
  assert.deepEqual(parseCommand('添加列表：甲；乙'), { type: 'appendBlock', blockType: 'list', text: '甲；乙', items: ['甲', '乙'], ordered: false });
  assert.equal(parseCommand('添加表格：A|B\n1|2').blockType, 'table');
  assert.deepEqual(parseCommand('把当前改成引用'), { type: 'convertSelected', blockType: 'quote', text: undefined });
  assert.equal(parseCommand('第 3 段改成标题：关键结论').index, 2);
  assert.deepEqual(parseCommand('主题：杂志'), { type: 'setTheme', theme: 'editorial' });
  assert.deepEqual(parseCommand('主题：墨韵'), { type: 'setTheme', theme: 'ink' });
  assert.deepEqual(parseCommand('去 AI 味：保守'), { type: 'humanize', mode: 'conservative' });
});

test('theme catalog contains five distinct workspace themes', () => {
  assert.deepEqual(Object.keys(THEMES), ['minimal', 'editorial', 'fresh', 'ink', 'sunset']);
  assert.equal(normalizeTheme('暖阳'), 'sunset');
  const minimal = renderArticleHtml({ ...createInitialDocument(), theme: 'minimal' });
  const sunset = renderArticleHtml({ ...createInitialDocument(), theme: 'sunset' });
  assert.notEqual(minimal, sunset);
  assert.match(sunset, /#e45f3f/);
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
