import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER_SPEC, draftCoverCopy, renderCoverSvg, auditCoverImage } from '../src/cover.js';

test('SVG headline cover is 900x383 and centers text', () => {
  const svg = renderCoverSvg({ main: '测试封面', sub: '副文案', kind: 'headline' });
  assert.match(svg, /width="900" height="383"/);
  assert.match(svg, /text-anchor="middle"/);
  assert.match(svg, /测试封面/);
});

test('SVG square cover is 383x383', () => {
  const svg = renderCoverSvg({ main: '方图', kind: 'square' });
  assert.match(svg, /width="383" height="383"/);
});

test('draftCoverCopy clips main copy to <=10 chars and flags checks', () => {
  const r = draftCoverCopy({ title: '这是一个非常非常非常冗长的标题应该被压缩到十个字以内显示', body: '正文里有 7 个技巧' });
  assert.ok([...r.candidates[0].main].length <= 10);
  assert.ok(Array.isArray(r.checks));
});

test('draftCoverCopy picks up number signal', () => {
  const r = draftCoverCopy({ title: '3个方法提升效率', body: '', formula: 'number' });
  assert.equal(r.candidates[0].formula, 'number');
  assert.equal(r.signals.number, '3');
});

test('auditCoverImage accepts 900x383 and rejects wrong ratio', () => {
  assert.equal(auditCoverImage({ width: 900, height: 383, bytes: 500000 }).ok, true);
  assert.equal(auditCoverImage({ width: 383, height: 383, bytes: 500000 }).ok, true);
  const bad = auditCoverImage({ width: 800, height: 600, bytes: 500000 });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.length >= 1);
});

test('auditCoverImage flags oversize file and width', () => {
  const r = auditCoverImage({ width: 2000, height: 851, bytes: 12 * 1024 * 1024 });
  assert.ok(r.issues.some(i => i.includes('1280')));
  assert.ok(r.issues.some(i => i.includes('10MB')));
});

test('COVER_SPEC exposes official dimensions', () => {
  assert.equal(COVER_SPEC.headline.w, 900);
  assert.equal(COVER_SPEC.headline.h, 383);
  assert.equal(COVER_SPEC.square.w, 383);
});
