import test from 'node:test';
import assert from 'node:assert/strict';
import { WECHAT_LIMITS, charCount, byteCount, inspectWechatArticle, inspectWechatCover, contentForWechatMeasurement } from '../src/wechat-limits.js';

test('微信字段按 Unicode 字符计数并遵守标题、作者、摘要上限', () => {
  assert.equal(charCount('😀'), 1);
  assert.equal(byteCount('中'), 3);
  assert.equal(inspectWechatArticle({ title: '字'.repeat(WECHAT_LIMITS.titleChars), author: '名'.repeat(WECHAT_LIMITS.authorChars), digest: '摘'.repeat(WECHAT_LIMITS.digestChars), content: '正文' }).ok, true);
  assert.equal(inspectWechatArticle({ title: '字'.repeat(WECHAT_LIMITS.titleChars + 1), content: '正文' }).errors[0].id, 'title');
  assert.equal(inspectWechatArticle({ digest: '摘'.repeat(WECHAT_LIMITS.digestChars + 1), content: '正文' }).errors[0].id, 'digest');
});

test('正文必须同时小于 20000 字符和 1MiB', () => {
  assert.equal(inspectWechatArticle({ content: '正'.repeat(WECHAT_LIMITS.contentChars - 1) }).ok, true);
  assert.equal(inspectWechatArticle({ content: '正'.repeat(WECHAT_LIMITS.contentChars) }).errors.some(item => item.id === 'contentChars'), true);
  const oversized = 'a'.repeat(WECHAT_LIMITS.contentBytes);
  assert.equal(inspectWechatArticle({ content: oversized }).errors.some(item => item.id === 'contentBytes'), true);
});

test('本地图片 Base64 在正文大小检查中按上传后的 URL 计量', () => {
  const html = `<p>正文</p><img src="data:image/png;base64,${'A'.repeat(WECHAT_LIMITS.contentBytes)}">`;
  assert.ok(contentForWechatMeasurement(html).length < 100);
  assert.equal(inspectWechatArticle({ content: html }).ok, true);
});

test('原文链接检查以 UTF-8 字节数为准', () => {
  const result = inspectWechatArticle({ content: '正文', contentSourceUrl: '中'.repeat(400) });
  assert.equal(result.errors.some(item => item.id === 'sourceUrl'), true);
});

test('标题图片规则与正文规则共用同一限制表', () => {
  const valid = inspectWechatCover({ width: 900, height: 383, bytes: 500_000, type: 'image/jpeg', main: '山野茶事', sub: '真实体验' });
  assert.equal(valid.ok, true);
  const invalid = inspectWechatCover({ width: 1600, height: 900, bytes: WECHAT_LIMITS.titleImage.maxBytes + 1, type: 'image/svg+xml', main: '这是超长标题图片文案示例', sub: '这是超长副文案也超限' });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some(item => item.includes('比例')));
  assert.ok(invalid.errors.some(item => item.includes('10MB')));
  assert.ok(invalid.errors.some(item => item.includes('主文案')));
  assert.ok(invalid.errors.some(item => item.includes('PNG/JPEG')));
});
