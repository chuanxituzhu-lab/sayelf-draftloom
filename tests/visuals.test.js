import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoComposeDocument, deriveArticleTitle, deriveImageBudget, evaluateHotTopicFit, extractCoreContent, extractKeywords, generateArticleKeywords, generateViralTitlePlan, planVisualLayout, recognizeAssetContent, renderCreativeSvg } from '../src/visuals.js';
import { importArticle, parseCommand } from '../src/core.js';

test('natural language command exposes smart visual composition', () => {
  assert.deepEqual(parseCommand('智能配图'), { type: 'autoComposeVisuals', generate: true, maxGenerated: 3, autoImageCount: true, titleMode: 'viral' });
  assert.deepEqual(parseCommand('图片自动导入'), { type: 'autoComposeVisuals', generate: false, maxGenerated: 0, autoImageCount: true, fillUnmatched: true, titleMode: 'safe' });
  assert.deepEqual(parseCommand('图片智能导入'), { type: 'autoComposeVisuals', generate: false, maxGenerated: 0, autoImageCount: true, fillUnmatched: true, titleMode: 'safe' });
  assert.deepEqual(parseCommand('根据核心内容生成两张主题图片'), { type: 'generateCoreThemeImages', count: 2 });
});

test('title derivation prefers a markdown heading and keeps WeChat length safe', () => {
  const result = deriveArticleTitle({ text: '# 山野茶的第一口春天\n\n正文从这里开始。' });
  assert.equal(result.title, '山野茶的第一口春天');
  assert.ok([...result.title].length <= 32);
  assert.equal(result.source, 'heading');
});

test('viral title plan summarizes the article and stays within the WeChat title limit', () => {
  const plan = generateViralTitlePlan({
    text: '# 罗森塔尔效应\n\n老师的期待会改变孩子的表现，家庭中的鼓励也会影响成长。',
    profile: { targetKeywords: ['心理暗示'] }
  });
  assert.equal(plan.mode, 'viral');
  assert.ok(plan.summary.includes('老师的期待'));
  assert.ok(plan.candidates.length >= 3);
  assert.ok(plan.candidates.every(item => [...item.title].length <= 32));
  assert.equal(plan.selected, plan.candidates[0].title);
});

test('core extraction selects signal-bearing sentences and keeps reviewable points', () => {
  const core = extractCoreContent({
    text: '开头铺垫内容。AI 可以降低制作成本，但真正稀缺的是 Idea 的价值。执行决定结果，持续输出才能获得反馈。',
    max: 96,
    maxPoints: 3
  });
  assert.match(core.summary, /AI 可以降低制作成本/);
  assert.ok(core.points.some(point => point.includes('执行决定结果')));
  assert.equal(core.source, 'local-deterministic');
});

test('keyword extraction is deterministic and useful for semantic image matching', () => {
  const keywords = extractKeywords('山野茶 山野茶 自然生活与真实体验');
  assert.ok(keywords.includes('山野茶'));
  assert.ok(keywords.length <= 8);
});

test('core theme generation creates two local images and remains idempotent', () => {
  const doc = importArticle({ text: '# AI 与内容创作\n\nAI 可以降低制作成本，但 Idea 决定表达方向。持续发布、获得数据反馈，才能形成自己的方法。' });
  const first = autoComposeDocument(doc, { generate: true, includeCover: false, maxGenerated: 0, coreThemeCount: 2 });
  const firstThemes = first.assets.filter(asset => asset.visualPurpose === 'core-theme');
  const firstBlocks = first.blocks.filter(block => block.visualPurpose === 'core-theme');
  assert.equal(firstThemes.length, 2);
  assert.equal(firstBlocks.length, 2);
  assert.equal(first.meta.visualPlan.coreThemeImageIds.length, 2);
  assert.ok(firstThemes.every(asset => asset.name.startsWith('draftloom-theme-')));
  const second = autoComposeDocument(first, { generate: true, includeCover: false, maxGenerated: 0, coreThemeCount: 2 });
  assert.equal(second.assets.filter(asset => asset.visualPurpose === 'core-theme').length, 2);
  assert.equal(second.blocks.filter(block => block.visualPurpose === 'core-theme').length, 2);
});

test('article keyword plan returns deduplicated copy-ready hashtags', () => {
  const plan = generateArticleKeywords({
    title: '山野茶与自然生活',
    text: '山野茶来自真实的自然生活。山野茶需要耐心冲泡，也需要尊重季节。'
  });
  assert.ok(plan.keywords.includes('山野茶'));
  assert.equal(plan.keywords.length, new Set(plan.keywords).size);
  assert.equal(plan.hashtags.length, plan.keywords.length);
  assert.equal(plan.text, plan.hashtags.join(' '));
  assert.ok(plan.hashtags.every(tag => /^#[\u4e00-\u9fffA-Za-z0-9_-]+$/.test(tag)));
  assert.equal(plan.source, 'local-deterministic');
});

test('hot topic fit stays evidence-bound and distinguishes direct from weak matches', () => {
  const direct = evaluateHotTopicFit({
    title: 'AI 如何改变内容创作',
    text: 'AI 可以降低内容制作成本，但作者仍需保留自己的判断和执行。',
    hotTopics: '#AI\n#旅游消费'
  });
  assert.equal(direct.verified, true);
  assert.equal(direct.level, 'strong');
  assert.ok(direct.matchedTopics.includes('AI'));
  assert.match(direct.note, /正文/);

  const spacedTags = evaluateHotTopicFit({ title: 'AI 内容创作', text: 'AI 帮助作者提高效率。', hotTopics: '#AI #旅游消费' });
  assert.equal(spacedTags.matchedTopics.includes('AI'), true);

  const unknown = evaluateHotTopicFit({ title: '山野茶日记', text: '记录一杯茶和自然生活。' });
  assert.equal(unknown.verified, false);
  assert.equal(unknown.level, 'unknown');
  assert.equal(unknown.decision, '待核验实时热榜');
});

test('image recognition uses vision metadata and exposes semantic labels', () => {
  const recognition = recognizeAssetContent({
    name: 'IMG_001.jpg',
    vision: { caption: '山野茶园晨雾', labels: ['自然', '茶叶'], ocrText: '春茶采摘', confidence: 0.93, provider: 'test-vision' }
  });
  assert.equal(recognition.source, 'test-vision');
  assert.ok(recognition.labels.includes('自然山野'));
  assert.ok(recognition.labels.includes('茶与饮品'));
  assert.ok(recognition.keywords.includes('自然'));
  assert.equal(recognition.confidence, 0.93);
});

test('image budget scales with article length and section density', () => {
  const short = importArticle({ text: '# 短文\n\n一句简短的说明。' });
  const long = importArticle({ text: '# 长文\n\n## 第一部分\n\n' + '这里是一段用于验证篇幅预算的内容，包含观点、方法和执行细节。'.repeat(18) + '\n\n## 第二部分\n\n' + '这一部分继续补充案例、反馈和复盘。'.repeat(18) + '\n\n## 第三部分\n\n' + '最后总结长期实践与个人判断。'.repeat(18) });
  const shortBudget = deriveImageBudget(short);
  const longBudget = deriveImageBudget(long);
  assert.equal(shortBudget.bodyImages, 1);
  assert.ok(longBudget.bodyImages > shortBudget.bodyImages);
  assert.equal(longBudget.totalImages, longBudget.bodyImages + 1);
  assert.equal(longBudget.mode, 'local-deterministic');
});

test('automatic composition respects the content image budget', () => {
  const input = importArticle({ text: '# 长文配图\n\n## 观点\n\n' + '这是一段足够长的观点内容，用来验证自动匹配图片数量。'.repeat(12) + '\n\n## 方法\n\n' + '这是一段足够长的方法内容，用来验证自动匹配图片数量。'.repeat(12) + '\n\n## 执行\n\n' + '这是一段足够长的执行内容，用来验证自动匹配图片数量。'.repeat(12) });
  const composed = autoComposeDocument(input, { generate: true, includeCover: false, autoImageCount: true });
  const bodyImages = composed.blocks.filter(block => block.type === 'image' && block.assetId).length;
  assert.equal(bodyImages, composed.meta.visualPlan.imageBudget.bodyImages);
  assert.equal(composed.meta.visualPlan.imageBudget.auto, true);
  assert.ok(composed.meta.visualPlan.imageBudget.plannedNewBodyImages >= 1);
});

test('automatic asset fill stops at the content image budget', () => {
  const assets = Array.from({ length: 8 }, (_, index) => ({ id: `library-${index}`, name: `图片-${index}.png`, type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==', alt: `图片-${index}` }));
  const input = importArticle({ text: '# 预算测试\n\n## 第一节\n\n这一节内容足够长，可以自动匹配素材。\n\n## 第二节\n\n这一节内容也足够长，可以继续匹配素材。', assets: [] });
  input.assets = assets;
  const composed = autoComposeDocument(input, { generate: false, includeCover: false, autoImageCount: true, fillUnmatched: true });
  const bodyImages = composed.blocks.filter(block => block.type === 'image' && block.assetId).length;
  assert.equal(bodyImages, composed.meta.visualPlan.imageBudget.bodyImages);
  assert.ok(composed.meta.visualPlan.placements.length <= composed.meta.visualPlan.imageBudget.bodyImages);
});

test('recognized image content is matched to the relevant article section', () => {
  const teaAsset = { id: 'tea-scene', name: 'IMG_001.jpg', type: 'image/jpeg', size: 1, dataUrl: 'data:image/jpeg;base64,AA==', alt: '山野茶园晨雾', vision: { caption: '山野茶园晨雾', labels: ['茶叶', '自然'] } };
  const normalized = importArticle({ text: '# 山野茶', assets: [teaAsset] });
  assert.deepEqual(normalized.assets[0].vision, teaAsset.vision);
  const input = importArticle({ text: '# 山野茶\n\n## 春茶采摘\n\n春茶采摘需要顺着山势观察茶园的雾气。', assets: [] });
  input.assets = [teaAsset];
  const composed = autoComposeDocument(input, { generate: false, includeCover: false, fillUnmatched: false });
  const placement = composed.meta.visualPlan.placements.find(item => item.assetId === 'tea-scene');
  assert.equal(placement.reason, '图片内容识别+章节语义匹配');
  assert.ok(placement.anchorId);
  assert.ok(placement.matchedLabels.includes('自然山野') || placement.matchedLabels.includes('茶与饮品'));
  assert.ok(composed.blocks.some(block => block.type === 'image' && block.assetId === 'tea-scene' && block.visualMatch?.reason === '图片内容识别+章节语义匹配'));
});

test('visual planner assigns an available asset to a section and reports missing visuals', () => {
  const doc = importArticle({ text: '# 茶的日常\n\n## 冲泡方法\n\n先温杯，再慢慢注水。', assets: [] });
  const plan = planVisualLayout(doc, { maxGenerated: 1 });
  assert.equal(plan.coverAssetId, null);
  assert.equal(plan.sectionPlacements.length, 1);
  assert.equal(plan.sectionPlacements[0].role, 'section');
});

test('auto compose generates a title cover and section visual without network access', () => {
  const doc = importArticle({
    text: '# 山野茶的第一口春天\n\n## 冲泡方法\n\n先温杯，再慢慢注水。',
    filename: 'tea.md',
    autoCompose: true,
    visualOptions: { generate: true, maxGenerated: 2 }
  });
  assert.equal(doc.title, '山野茶的第一口春天');
  assert.equal(doc.blocks[0].type, 'image');
  assert.equal(doc.blocks[0].visualRole, 'cover');
  assert.ok(doc.assets.some(asset => asset.generated && asset.visualRole === 'cover'));
  assert.ok(doc.blocks.some(block => block.type === 'image' && block.visualRole === 'section'));
  assert.equal(doc.meta.visualPlan.provider, 'local-svg-fallback');
  assert.match(doc.assets.find(asset => asset.visualRole === 'cover').dataUrl, /^data:image\/svg\+xml/);
});

test('viral composition applies a title plan but respects a human-locked title', () => {
  const input = importArticle({ text: '# 原始标题\n\n一段关于山野茶和自然生活的真实记录。' });
  const viral = autoComposeDocument(input, { generate: false, titleMode: 'viral', forceTitle: true });
  assert.equal(viral.meta.titlePlan.mode, 'viral');
  assert.equal(viral.title, viral.meta.titlePlan.selected);
  const locked = autoComposeDocument({ ...viral, meta: { ...viral.meta, titleLocked: true }, title: '人工确认标题' }, { generate: false, titleMode: 'viral' });
  assert.equal(locked.title, '人工确认标题');
  assert.equal(locked.meta.titlePlan.applied, false);
});

test('auto compose uses uploaded cover and section assets before generating fallbacks', () => {
  const cover = { id: 'cover-asset', name: '封面.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==', alt: '封面' };
  const section = { id: 'tea-asset', name: '冲泡方法.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==', alt: '冲泡方法' };
  const doc = importArticle({
    text: '# 山野茶\n\n## 冲泡方法\n\n先温杯，再注水。',
    assets: [cover, section],
    autoCompose: true,
    visualOptions: { generate: true, maxGenerated: 2 }
  });
  assert.equal(doc.blocks[0].assetId, 'cover-asset');
  assert.ok(doc.blocks.some(block => block.visualRole === 'section' && block.assetId === 'tea-asset'));
  assert.equal(doc.assets.filter(asset => asset.generated).length, 0);
});

test('asset fill mode inserts otherwise-unmatched library images in order', () => {
  const first = { id: 'library-a', name: 'Codex 图像 A.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==', alt: '图片 A' };
  const second = { id: 'library-b', name: 'Codex 图像 B.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==', alt: '图片 B' };
  const doc = importArticle({ text: '# 文章主题\n\n## 第一部分\n\n第一段内容足够长，可以作为自动填充图片的章节锚点。\n\n## 第二部分\n\n第二段内容也足够长，可以继续放置第二张素材图片。', assets: [first, second], autoCompose: true, visualOptions: { generate: false, fillUnmatched: true } });
  assert.ok(doc.blocks.filter(block => block.type === 'image').some(block => block.assetId === 'library-a'));
  assert.ok(doc.blocks.filter(block => block.type === 'image').some(block => block.assetId === 'library-b'));
  assert.ok(doc.meta.visualPlan.placements.some(item => item.reason === '素材库图片自动填充'));
});

test('re-running visual composition does not duplicate generated assets or blocks', () => {
  const original = importArticle({ text: '一段关于山野茶和自然生活的真实记录。\n\n第二段讲冲泡方法。', autoCompose: true });
  const beforeAssets = original.assets.length;
  const beforeBlocks = original.blocks.length;
  const rerun = autoComposeDocument(original, { generate: true, maxGenerated: 3 });
  assert.equal(rerun.assets.length, beforeAssets);
  assert.equal(rerun.blocks.length, beforeBlocks);
});

test('creative SVG includes human-readable title and review boundary', () => {
  const svg = renderCreativeSvg({ title: '山野茶', subtitle: '自然生活', keywords: ['茶', '山野'], role: 'cover' });
  assert.match(svg, /山野茶/);
  assert.match(svg, /人工可替换/);
});
