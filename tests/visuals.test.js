import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoComposeDocument, deriveArticleTitle, extractKeywords, generateViralTitlePlan, planVisualLayout, recognizeAssetContent, renderCreativeSvg } from '../src/visuals.js';
import { importArticle, parseCommand } from '../src/core.js';

test('natural language command exposes smart visual composition', () => {
  assert.deepEqual(parseCommand('智能配图'), { type: 'autoComposeVisuals', generate: true, maxGenerated: 3, titleMode: 'viral' });
  assert.deepEqual(parseCommand('图片自动导入'), { type: 'autoComposeVisuals', generate: false, maxGenerated: 0, fillUnmatched: true, titleMode: 'safe' });
  assert.deepEqual(parseCommand('图片智能导入'), { type: 'autoComposeVisuals', generate: false, maxGenerated: 0, fillUnmatched: true, titleMode: 'safe' });
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

test('keyword extraction is deterministic and useful for semantic image matching', () => {
  const keywords = extractKeywords('山野茶 山野茶 自然生活与真实体验');
  assert.ok(keywords.includes('山野茶'));
  assert.ok(keywords.length <= 8);
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
