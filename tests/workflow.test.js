import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  distillArticleStage,
  getWorkflowState,
  humanizeArticleStage,
  layoutArticleStage,
  prepareWorkflowSubmission,
  recognizeArticleStage,
  recordWorkflowSubmission,
  reviewArticleStage,
  runPublishingWorkflow,
  skipHumanizeArticleStage
} from '../src/workflow.js';

const source = '# 一篇可发布的文章\n\n真正重要的是先把问题说清楚，再给出可执行的方法。\n\n第二部分：方法需要结合真实案例，最后回到读者可以带走的结论。';

test('publishing stages keep their responsibilities separate', () => {
  const recognized = recognizeArticleStage({ text: source, filename: 'article.md' });
  assert.equal(getWorkflowState(recognized.doc).stages.recognize.status, 'complete');
  assert.equal(recognized.doc.meta.visualPlan, undefined);
  assert.equal(recognized.doc.assets.length, 0);

  const bodyBeforeDistill = structuredClone(recognized.doc.blocks);
  const distilled = distillArticleStage(recognized.doc);
  assert.equal(getWorkflowState(distilled.doc).stages.distill.status, 'complete');
  assert.ok(distilled.doc.meta.contentAnalysis.coreContent.summary);
  assert.equal(distilled.doc.meta.contentAnalysis.coreContent.type, 'CoreContent');
  assert.equal(distilled.doc.meta.contentAnalysis.coreContent.epistemic, 'inference');
  assert.equal(distilled.doc.meta.contentAnalysis.coreValidation.ok, true);
  assert.equal(distilled.doc.meta.contentAnalysis.metadata.bodyRewritten, false);
  assert.equal(distilled.doc.meta.contentAnalysis.metadata.requiresReview, true);
  assert.equal(distilled.doc.meta.contentAnalysis.metadata.localOnly, true);
  assert.deepEqual(distilled.doc.blocks, bodyBeforeDistill);
  assert.equal(distilled.report.bodyRewritten, false);
  assert.ok(distilled.report.titleCandidates.length >= 1);

  const laidOut = layoutArticleStage(distilled.doc, { generateImages: true, maxGenerated: 1 });
  assert.equal(getWorkflowState(laidOut.doc).stages.layout.status, 'complete');
  assert.equal(laidOut.doc.blocks[0].visualRole, 'cover');
  assert.ok(laidOut.doc.meta.layoutProfile);

  const reviewed = reviewArticleStage(laidOut.doc);
  assert.ok(['passed', 'needs-review'].includes(reviewed.report.status));
  assert.equal(reviewed.report.readyForSubmit, true);
  assert.equal(getWorkflowState(reviewed.doc).stages.review.report.readyForSubmit, true);
  assert.equal(prepareWorkflowSubmission(reviewed.doc).ok, true);
});

test('recognition keeps an asset library available without appending unrelated images', () => {
  const asset = { id: 'library-only', name: '历史素材.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==', alt: '历史素材' };
  const recognized = recognizeArticleStage({ text: source, filename: 'article.md', assets: [asset] });
  assert.equal(recognized.doc.assets.length, 1);
  assert.equal(recognized.doc.blocks.some(block => block.type === 'image'), false);
  assert.equal(recognized.report.imageCount, 0);
  assert.match(recognized.report.warnings.join('；'), /素材库/);
});

test('upstream rerun invalidates downstream stage evidence', () => {
  const result = runPublishingWorkflow({ text: source, filename: 'article.md' }, { generateImages: true, maxGenerated: 1 });
  const rerun = distillArticleStage(result.doc);
  const workflow = getWorkflowState(rerun.doc);
  assert.equal(workflow.stages.distill.status, 'complete');
  assert.equal(workflow.stages.layout.status, 'stale');
  assert.equal(workflow.stages.review.status, 'stale');
  assert.equal(workflow.stages.submit.status, 'stale');
});

test('review blocks submission when the required cover is missing', () => {
  const recognized = recognizeArticleStage({ text: source, filename: 'article.txt' });
  const distilled = distillArticleStage(recognized.doc);
  const laidOut = layoutArticleStage(distilled.doc, { generateImages: false });
  const reviewed = reviewArticleStage(laidOut.doc);
  assert.equal(reviewed.report.status, 'blocked');
  assert.equal(reviewed.report.readyForSubmit, false);
  assert.equal(prepareWorkflowSubmission(reviewed.doc).ok, false);
});

test('submission result is recorded without storing credentials', () => {
  const result = runPublishingWorkflow({ text: source, filename: 'article.md' }, { generateImages: true, maxGenerated: 1 });
  const submitted = recordWorkflowSubmission(result.doc, { mode: 'wechat-api', status: 'submitted', draftId: 'draft-123' });
  const stage = getWorkflowState(submitted).stages.submit;
  assert.equal(stage.status, 'submitted');
  assert.equal(stage.report.draftId, 'draft-123');
  assert.equal(JSON.stringify(submitted).includes('access_token'), false);
});

test('humanize stage previews body changes and requires an explicit apply', () => {
  const recognized = recognizeArticleStage({ text: '# 标题\n\n众所周知，我们可以看到很多内容。第二句保留。', filename: 'article.md' });
  const preview = humanizeArticleStage(recognized.doc, { mode: 'natural' });
  assert.equal(preview.report.status, 'needs-review');
  assert.equal(preview.report.preview, true);
  assert.equal(preview.report.bodyRewritten, true);
  assert.match(preview.report.diff[0].after, /很多内容/);
  assert.match(preview.doc.blocks[0].text, /众所周知/);
  assert.equal(getWorkflowState(preview.doc).readyForSubmit, false);

  const applied = humanizeArticleStage(preview.doc, { mode: 'natural', apply: true });
  assert.equal(applied.report.applied, true);
  assert.equal(applied.doc.blocks[0].text.includes('众所周知'), false);
  assert.equal(getWorkflowState(applied.doc).stages.humanize.status, 'complete');
  assert.equal(getWorkflowState(applied.doc).stages.humanize.report.handoff.accepted, true);
});

test('workflow can insert humanize before distillation and pauses at its human gate', () => {
  const preview = runPublishingWorkflow({ text: '# 标题\n\n众所周知，我们可以看到很多内容。第二句保留。', filename: 'article.md' }, { humanizeMode: 'natural', generateImages: false });
  assert.equal(preview.haltedAt, 'humanize');
  assert.equal(preview.reports.distill, null);
  assert.equal(getWorkflowState(preview.doc).stages.humanize.status, 'needs-review');

  const accepted = runPublishingWorkflow({ text: '# 标题\n\n众所周知，我们可以看到很多内容。第二句保留。', filename: 'article.md' }, { humanizeMode: 'natural', applyHumanize: true, generateImages: true, maxGenerated: 1 });
  assert.equal(accepted.haltedAt, undefined);
  assert.equal(accepted.reports.humanize.applied, true);
  assert.equal(accepted.reports.distill.bodyRewritten, false);
  assert.equal(getWorkflowState(accepted.doc).stages.humanize.status, 'complete');
  assert.equal(getWorkflowState(accepted.doc).stages.distill.status, 'complete');
  assert.ok(getWorkflowState(accepted.doc).ledger.length >= 6);
});

test('optional humanize can be declined without changing the original body', () => {
  const recognized = recognizeArticleStage({ text: '# 标题\n\n众所周知，我们可以看到很多内容。', filename: 'article.md' });
  const preview = humanizeArticleStage(recognized.doc, { mode: 'natural' });
  const skipped = skipHumanizeArticleStage(preview.doc);
  assert.equal(skipped.report.status, 'skipped');
  assert.match(skipped.doc.blocks[0].text, /众所周知/);
  assert.equal(getWorkflowState(skipped.doc).stages.humanize.status, 'skipped');
});

test('default workflow skips optional humanize without changing the five core stages', () => {
  const result = runPublishingWorkflow({ text: source, filename: 'article.md' }, { generateImages: true, maxGenerated: 1 });
  const workflow = getWorkflowState(result.doc);
  assert.equal(workflow.stages.humanize.status, 'skipped');
  assert.equal(workflow.stages.humanize.report.applied, false);
  assert.equal(workflow.stages.distill.status, 'complete');
  assert.equal(workflow.stages.review.report.readyForSubmit, true);
});

test('WebUI binds both one-click 1-4 buttons without duplicate IDs', async () => {
  const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.equal((appSource.match(/id="workflowRunBtn"/g) || []).length, 1);
  assert.equal((appSource.match(/id="workflowRunTopBtn"/g) || []).length, 1);
  assert.match(appSource, /querySelectorAll\('#workflowRunBtn, #workflowRunTopBtn'\)/);
  assert.match(appSource, /button\.onclick = runLocalPublishingWorkflow/);
});
