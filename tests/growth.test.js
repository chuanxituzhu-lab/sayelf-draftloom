import test from 'node:test';
import assert from 'node:assert/strict';
import { importArticle } from '../src/core.js';
import { analyzeGrowth, getDefaultGrowthProfile, growthBrief } from '../src/growth.js';

test('growth analysis keeps missing cover as a hard draft blocker', () => {
  const doc = importArticle({ text: '# 山野茶日记\n\n为什么一杯茶会让人慢下来？\n\n' + '山野茶与自然生活的真实记录。'.repeat(40) });
  const report = analyzeGrowth(doc, getDefaultGrowthProfile());
  assert.equal(report.compliance.decision, 'BLOCKED');
  assert.match(report.compliance.checks[0].messages[0], /封面图/);
  assert.ok(report.viral.score >= 0 && report.viral.score <= 100);
});

test('growth brief follows the editable account profile', () => {
  const doc = importArticle({ text: '# 山野茶的春天\n\n今天记录一段真实的采茶过程。' });
  const brief = growthBrief(doc, { accountName: '测试公众号', positioning: '春茶与山野旅行', targetKeywords: ['春茶'] });
  assert.equal(brief.account, '测试公众号');
  assert.match(brief.creativeDirection, /春茶与山野旅行/);
  assert.ok(brief.titleSuggestions.some(title => title.includes('春茶')));
});
