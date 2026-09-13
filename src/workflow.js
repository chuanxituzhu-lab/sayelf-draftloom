import {
  autoFormatDocument,
  clone,
  getLayoutGuidance,
  humanizeDocument,
  importArticle,
  optimizeWechatDocument,
  renderArticleHtml
} from './core.js';
import {
  autoComposeDocument,
  extractCoreContent,
  generateArticleKeywords,
  generateViralTitlePlan
} from './visuals.js';
import { WECHAT_LIMITS, inspectWechatArticle, inspectWechatCover, charCount } from './wechat-limits.js';

/**
 * The publishing workflow is deliberately a coordinator, not a second
 * editor. Each stage returns a document snapshot plus a small evidence report;
 * the caller still commits the snapshot through its own VersionStore.
 */
export const WORKFLOW_VERSION = 2;
export const WORKFLOW_STAGES = Object.freeze([
  Object.freeze({ key: 'recognize', label: '识别文字', description: '把文字稿、Markdown、DOCX、PDF 变成结构化区块' }),
  Object.freeze({ key: 'humanize', label: '自然化', description: '可选地把正文调整为更自然的人类表达；必须先预览并确认', optional: true }),
  Object.freeze({ key: 'distill', label: '提炼内容', description: '提炼核心观点、标题候选、概要和关键词' }),
  Object.freeze({ key: 'layout', label: '自动排版', description: '统一字体、段落、层级、重点标注和图片位置' }),
  Object.freeze({ key: 'review', label: '公众号审核', description: '检查字段、正文、封面和微信兼容性' }),
  Object.freeze({ key: 'submit', label: '提交草稿箱', description: '经确认后上传素材并创建公众号草稿' })
]);
export const WORKFLOW_STAGE_KEYS = Object.freeze(WORKFLOW_STAGES.map(stage => stage.key));
export const WORKFLOW_CONTRACTS = Object.freeze({
  recognize: Object.freeze({ requiredInputs: ['文章文字或现有文档'], outputs: ['结构化区块', '识别报告'], acceptance: '存在可用文字；文件类型和识别警告已记录', handoff: 'humanize' }),
  humanize: Object.freeze({ requiredInputs: ['已识别的结构化正文'], outputs: ['自然化预览或新正文版本', '正文差异报告'], acceptance: '预览需人工确认；应用后正文产生可回退版本', handoff: 'distill' }),
  distill: Object.freeze({ requiredInputs: ['已接受的正文'], outputs: ['核心内容', '标题候选', '内容概要', '关键词'], acceptance: '结果可追溯到当前正文；不静默改写正文', handoff: 'layout' }),
  layout: Object.freeze({ requiredInputs: ['核心内容和结构化正文'], outputs: ['微信兼容排版', '图片位置计划'], acceptance: '排版不改变语义；图片数量受内容预算约束', handoff: 'review' }),
  review: Object.freeze({ requiredInputs: ['最终排版文档'], outputs: ['微信规则检查报告'], acceptance: '字段、正文、封面和素材通过或明确标记人工问题', handoff: 'submit' }),
  submit: Object.freeze({ requiredInputs: ['审核通过的草稿 payload'], outputs: ['本地草稿包或微信草稿编号'], acceptance: '远程成功必须有接口事实；默认不产生网络副作用', handoff: null })
});

const DEFAULT_SUBTITLE = '自动排版草稿 · 可继续人工编辑';
const DEFAULT_TITLE = /^(?:未命名公众号文章|未命名文章|新文章)$/;
const IMAGE_TYPES_ACCEPTED_BY_WECHAT = new Set(WECHAT_LIMITS.titleImage.acceptedTypes.map(type => type.toLowerCase()));

function now() { return new Date().toISOString(); }
function clean(value = '') { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function blockText(block = {}) {
  return clean(block.text || (Array.isArray(block.items) ? block.items.join('；') : '') || (Array.isArray(block.rows) ? block.rows.flat().join('；') : ''));
}
function workflowSource(doc = {}) {
  const blocks = (doc.blocks || []).filter(block => block.type !== 'image');
  return blocks.map(blockText).filter(Boolean).join('\n') || String(doc.original?.text || '');
}
function sourceKind(filename = '') {
  const extension = String(filename).split('.').pop()?.toLowerCase();
  return extension === 'docx' ? 'docx' : extension === 'pdf' ? 'pdf' : extension === 'md' || extension === 'markdown' ? 'markdown' : 'text';
}
function stageTemplate(key, raw = {}) {
  const definition = WORKFLOW_STAGES.find(stage => stage.key === key);
  return {
    key,
    label: definition?.label || key,
    description: definition?.description || '',
    optional: definition?.optional === true,
    status: raw.status || 'not-run',
    at: raw.at || null,
    report: raw.report || null,
    error: raw.error || null,
    handoff: raw.handoff || null
  };
}

function emptyWorkflow() {
  return {
    version: WORKFLOW_VERSION,
    status: 'idle',
    currentStage: 'recognize',
    updatedAt: null,
    assembly: {
      profile: 'wechat-publishing',
      selected: [...WORKFLOW_STAGE_KEYS],
      optional: ['humanize'],
      validated: true
    },
    checkpoint: null,
    ledger: [],
    stages: Object.fromEntries(WORKFLOW_STAGE_KEYS.map(key => [key, stageTemplate(key)]))
  };
}

/** Return a safe, normalized workflow state for UI/CLI display. */
export function getWorkflowState(doc = {}) {
  const raw = doc.meta?.workflow && typeof doc.meta.workflow === 'object' ? doc.meta.workflow : {};
  const stages = Object.fromEntries(WORKFLOW_STAGE_KEYS.map(key => [key, stageTemplate(key, raw.stages?.[key] || {})]));
  const currentStage = WORKFLOW_STAGE_KEYS.includes(raw.currentStage) ? raw.currentStage : 'recognize';
  const status = raw.status || (stages.review.status === 'passed' ? 'ready' : 'idle');
  const humanizeGateOpen = !['needs-review', 'blocked', 'failed'].includes(stages.humanize.status);
  const requiredStagesReady = ['recognize', 'distill', 'layout', 'review'].every(key => !['not-run', 'stale', 'blocked', 'failed'].includes(stages[key].status));
  return {
    version: WORKFLOW_VERSION,
    status,
    currentStage,
    updatedAt: raw.updatedAt || null,
    assembly: raw.assembly || emptyWorkflow().assembly,
    checkpoint: raw.checkpoint || null,
    ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
    stages,
    readyForSubmit: humanizeGateOpen && requiredStagesReady && ['passed', 'needs-review'].includes(stages.review.status) && stages.review.report?.readyForSubmit === true,
    blocked: ['humanize', 'review'].some(key => ['blocked', 'failed'].includes(stages[key].status))
  };
}

function writeWorkflow(doc, key, value = {}, { invalidateDownstream = true } = {}) {
  const next = clone(doc);
  const previous = getWorkflowState(next);
  const stageIndex = WORKFLOW_STAGE_KEYS.indexOf(key);
  const stages = { ...previous.stages };
  const invalidatedStages = [];
  if (invalidateDownstream) {
    for (let index = stageIndex + 1; index < WORKFLOW_STAGE_KEYS.length; index += 1) {
      const downstream = WORKFLOW_STAGE_KEYS[index];
      if (stages[downstream].status !== 'not-run') invalidatedStages.push(downstream);
      stages[downstream] = stageTemplate(downstream, {
        status: stages[downstream].status === 'not-run' ? 'not-run' : 'stale',
        report: null,
        error: null,
        handoff: null
      });
    }
  }
  const status = value.status || 'complete';
  stages[key] = stageTemplate(key, { ...value, status, at: now(), handoff: value.handoff || value.report?.handoff || null });
  const reviewStatus = stages.review.status;
  const workflowStatus = status === 'blocked' ? 'blocked'
    : status === 'failed' ? 'failed'
      : status === 'needs-review' ? 'needs-review'
        : key === 'submit' && status === 'submitted' ? 'submitted'
          : reviewStatus === 'blocked' ? 'blocked'
            : key === 'review' || key === 'submit' ? 'ready' : 'in-progress';
  const previousLedger = Array.isArray(next.meta?.workflow?.ledger) ? next.meta.workflow.ledger : [];
  const eventAt = now();
  const event = {
    id: `workflow-${eventAt.replace(/\D/g, '')}-${key}-${previousLedger.length + 1}`,
    type: 'stage-transition',
    stage: key,
    from: previous.stages[key]?.status || 'not-run',
    to: status,
    at: eventAt,
    accepted: ['complete', 'passed', 'ready', 'submitted', 'skipped'].includes(status),
    evidence: value.evidence || { kind: 'stage-report', localOnly: value.report?.localOnly !== false },
    invalidatedStages
  };
  next.meta = {
    ...(next.meta || {}),
    workflow: {
      version: WORKFLOW_VERSION,
      status: workflowStatus,
      currentStage: key,
      updatedAt: eventAt,
      assembly: previous.assembly || emptyWorkflow().assembly,
      checkpoint: { stage: key, resumeFrom: key, at: eventAt },
      ledger: [...previousLedger, event].slice(-200),
      stages
    }
  };
  return next;
}

function imageAssetForCover(doc = {}) {
  const block = (doc.blocks || []).find(item => item.type === 'image' && item.visualRole === 'cover') || (doc.blocks || []).find(item => item.type === 'image');
  return { block, asset: block ? (doc.assets || []).find(asset => asset.id === block.assetId) || null : null };
}

function recognizeExistingDocumentStage(doc = {}) {
  const filename = doc.meta?.importedFrom || doc.original?.filename || '当前文章';
  const source = String(doc.original?.text || workflowSource(doc));
  const report = {
    status: source.trim() ? 'complete' : 'blocked',
    kind: sourceKind(filename),
    filename,
    inputChars: charCount(source),
    blockCount: (doc.blocks || []).length,
    paragraphCount: (doc.blocks || []).filter(block => block.type === 'paragraph').length,
    headingCount: (doc.blocks || []).filter(block => block.type === 'heading').length,
    imageCount: (doc.blocks || []).filter(block => block.type === 'image').length,
    assetCount: (doc.assets || []).length,
    warnings: [...(doc.meta?.importWarnings || [])],
    localOnly: true,
    reusedCurrentDocument: true,
    handoff: { accepted: source.trim().length > 0, from: 'recognize', to: 'humanize' }
  };
  return { doc: writeWorkflow(doc, 'recognize', { status: report.status, report }), report };
}

function expectedWechatImageType(asset = {}) {
  const type = String(asset.type || '').toLowerCase();
  if (IMAGE_TYPES_ACCEPTED_BY_WECHAT.has(type)) return type;
  // The local renderer and existing submit adapter rasterize SVG/WebP/GIF/BMP
  // before upload. Review the post-conversion shape instead of blocking a
  // document that is already safe for the actual submission path.
  if (type === 'image/svg+xml' || type === 'image/webp' || type === 'image/gif' || type === 'image/bmp') return 'image/jpeg';
  return type;
}

/** Stage 1: local recognition and structure extraction. */
export function recognizeArticleStage({ text = '', filename = 'pasted-article.txt', assets = [] } = {}) {
  const source = String(text ?? '');
  const doc = importArticle({ text: source, filename, assets, autoCompose: false });
  // The asset library is an input pool, not article content. Keep referenced
  // images (and an explicitly named cover) in the document, but do not append
  // every historical library item during recognition.
  const unmatchedWarnings = new Set();
  doc.meta.importWarnings = (doc.meta.importWarnings || []).filter(message => {
    if (!String(message).startsWith('图片未在原文中引用，已追加到文章末尾：')) return true;
    unmatchedWarnings.add(String(message).replace('图片未在原文中引用，已追加到文章末尾：', '').trim());
    return false;
  });
  doc.blocks = doc.blocks.filter(block => block.type !== 'image' || block.source || block.visualRole);
  const report = {
    status: source.trim() ? 'complete' : 'blocked',
    kind: sourceKind(filename),
    filename: String(filename || 'pasted-article.txt'),
    inputChars: charCount(source),
    blockCount: doc.blocks.length,
    paragraphCount: doc.blocks.filter(block => block.type === 'paragraph').length,
    headingCount: doc.blocks.filter(block => block.type === 'heading').length,
    imageCount: doc.blocks.filter(block => block.type === 'image').length,
    assetCount: doc.assets.length,
    warnings: [...(doc.meta?.importWarnings || []), ...(unmatchedWarnings.size ? [`素材库中有 ${unmatchedWarnings.size} 张图片未在原文引用，已保留在素材库供后续匹配`] : [])],
    localOnly: true,
    handoff: { accepted: source.trim().length > 0, from: 'recognize', to: 'humanize' }
  };
  const next = writeWorkflow(doc, 'recognize', { status: report.status, report });
  return { doc: next, report };
}

/** Mark an already imported document as recognized without rebuilding it. */
export function markDocumentRecognized(doc = {}) {
  return recognizeExistingDocumentStage(doc).doc;
}

function normalizeHumanizeMode(mode = 'natural') {
  return String(mode).toLowerCase() === 'conservative' ? 'conservative' : 'natural';
}

function humanizeDiff(before = {}, after = {}) {
  const beforeBlocks = new Map((before.blocks || []).map(block => [block.id, block]));
  return (after.blocks || [])
    .map(block => {
      const previous = beforeBlocks.get(block.id);
      if (!previous || previous.text === block.text || !['heading', 'paragraph', 'quote', 'cta'].includes(block.type)) return null;
      return { blockId: block.id, type: block.type, before: previous.text || '', after: block.text || '' };
    })
    .filter(Boolean);
}

/** Optional content stage: preview first, then explicitly apply a new body version. */
export function humanizeArticleStage(doc = {}, { mode = 'natural', apply = false } = {}) {
  const normalizedMode = normalizeHumanizeMode(mode);
  const source = workflowSource(doc);
  if (!source.trim()) {
    const report = { status: 'blocked', mode: normalizedMode, reason: '没有可自然化的正文', bodyRewritten: false, localOnly: true };
    return { doc: writeWorkflow(doc, 'humanize', { status: 'blocked', report }), report, previewDoc: clone(doc) };
  }
  const candidate = humanizeDocument(doc, normalizedMode);
  // Naturalization is a body stage. Titles and summaries are regenerated by the
  // following distill stage unless the user has explicitly edited them.
  candidate.title = doc.title;
  candidate.subtitle = doc.subtitle;
  const diff = humanizeDiff(doc, candidate);
  const report = {
    status: apply || diff.length === 0 ? 'complete' : 'needs-review',
    mode: normalizedMode,
    preview: !apply,
    applied: apply,
    bodyRewritten: diff.length > 0,
    changedBlocks: diff.length,
    diff: diff.slice(0, 40),
    preserved: ['事实、数字、引用和核心观点由后续审核复核；自然化只调整表达'],
    handoff: apply || diff.length === 0 ? { accepted: true, from: 'humanize', to: 'distill' } : { accepted: false, requiresHuman: '确认自然化预览后再继续提炼' },
    localOnly: true
  };
  if (!apply) {
    return {
      doc: writeWorkflow(doc, 'humanize', { status: report.status, report }, { invalidateDownstream: false }),
      report,
      previewDoc: candidate
    };
  }
  candidate.meta = {
    ...(candidate.meta || {}),
    humanizer: {
      ...(candidate.meta?.humanizer || {}),
      mode: normalizedMode,
      changedBlocks: diff.length,
      appliedAt: now(),
      workflowApplied: true
    }
  };
  return { doc: writeWorkflow(candidate, 'humanize', { status: 'complete', report }, { invalidateDownstream: diff.length > 0 }), report, previewDoc: candidate };
}

function skipHumanizeStage(doc = {}) {
  const report = {
    status: 'skipped',
    optional: true,
    applied: false,
    bodyRewritten: false,
    reason: '未启用去 AI 味，保留原文进入提炼',
    handoff: { accepted: true, from: 'humanize', to: 'distill' },
    localOnly: true
  };
  return { doc: writeWorkflow(doc, 'humanize', { status: 'skipped', report }, { invalidateDownstream: false }), report };
}

/** Explicitly decline the optional rewrite while keeping the original body. */
export function skipHumanizeArticleStage(doc = {}) {
  return skipHumanizeStage(doc);
}

/** Stage 3: evidence-bound content distillation. It never rewrites body copy. */
export function distillArticleStage(doc = {}, { applyTitleWhenMissing = true } = {}) {
  const humanizeStatus = getWorkflowState(doc).stages.humanize.status;
  if (['needs-review', 'blocked', 'failed'].includes(humanizeStatus)) {
    const report = {
      status: 'blocked',
      blockedBy: 'humanize',
      reason: '自然化预览尚未人工确认，不能把未接受的正文交给提炼阶段',
      bodyRewritten: false,
      localOnly: true
    };
    return { doc: writeWorkflow(doc, 'distill', { status: 'blocked', report }), report };
  }
  const next = clone(doc);
  const source = workflowSource(next);
  const coreContent = extractCoreContent({ text: source, title: next.title || '', max: 96, maxPoints: 3 });
  const titlePlan = generateViralTitlePlan({
    text: source,
    filename: next.meta?.importedFrom || '',
    currentTitle: next.title || '',
    keywords: coreContent.keywords,
    limit: 5
  });
  const keywordPlan = generateArticleKeywords({ title: next.title || titlePlan.selected, text: source, max: 8 });
  const titleWasMissing = !next.title || DEFAULT_TITLE.test(clean(next.title));
  const subtitleWasAutomatic = !next.subtitle || next.subtitle === DEFAULT_SUBTITLE || next.meta?.subtitleSource !== 'human';
  const changes = [];
  if (applyTitleWhenMissing && titleWasMissing && next.meta?.titleLocked !== true && titlePlan.selected) {
    next.title = titlePlan.selected;
    next.meta = { ...(next.meta || {}), titleSource: 'workflow-distill' };
    changes.push('缺少明确标题，已采用首个标题候选');
  }
  if (subtitleWasAutomatic && coreContent.summary) {
    if (next.subtitle !== coreContent.summary) changes.push('内容概要已根据核心观点更新');
    next.subtitle = coreContent.summary;
    next.meta = { ...(next.meta || {}), subtitleSource: 'core' };
  }
  next.meta = {
    ...(next.meta || {}),
    visualPlan: { ...(next.meta?.visualPlan || {}), coreContent, keywords: keywordPlan.keywords },
    titlePlan,
    contentAnalysis: {
      version: 1,
      source: 'local-deterministic',
      coreContent,
      titlePlan,
      keywordPlan,
      appliedAt: now()
    }
  };
  const report = {
    status: 'complete',
    source: 'local-deterministic',
    coreSummary: coreContent.summary,
    corePoints: coreContent.points,
    keywords: keywordPlan.keywords,
    selectedTitle: titlePlan.selected,
    titleCandidates: titlePlan.candidates.map(item => ({ title: item.title, rationale: item.rationale, score: item.score })),
    changes,
    bodyRewritten: false,
    handoff: { accepted: true, from: 'distill', to: 'layout' },
    localOnly: true
  };
  const output = writeWorkflow(next, 'distill', { status: 'complete', report });
  return { doc: output, report };
}

/** Stage 4: deterministic layout plus optional local visual composition. */
export function layoutArticleStage(doc = {}, { generateImages = true, maxGenerated = 3, autoImageCount = true, coreThemeCount = 0 } = {}) {
  const formatted = autoFormatDocument(doc);
  let next = formatted.doc;
  next = autoComposeDocument(next, {
    generate: generateImages !== false,
    maxGenerated: Math.max(0, Number(maxGenerated) || 0),
    includeCover: true,
    titleMode: 'safe',
    forceTitle: false,
    useCoreForCover: true,
    forceCoreSummary: true,
    fillUnmatched: false,
    autoImageCount: autoImageCount !== false,
    coreThemeCount: Math.min(4, Math.max(0, Number(coreThemeCount) || 0))
  });
  // Composition may insert a long paragraph after the first formatting pass;
  // a second deterministic pass keeps the final document within the same
  // paragraph rhythm without changing the semantic content.
  const finalFormat = autoFormatDocument(next);
  next = finalFormat.doc;
  const placements = next.meta?.visualPlan?.placements || [];
  const bodyImages = next.blocks.filter(block => block.type === 'image' && block.visualRole !== 'cover').length;
  const report = {
    status: 'complete',
    changes: [...new Set([...(formatted.changes || []), ...(finalFormat.changes || [])])],
    profile: finalFormat.profile,
    stats: finalFormat.stats,
    imageBudget: next.meta?.visualPlan?.imageBudget || null,
    placementCount: placements.length,
    bodyImages,
    generatedImages: next.assets.filter(asset => asset.generated).length,
    handoff: { accepted: true, from: 'layout', to: 'review' },
    localOnly: true
  };
  const output = writeWorkflow(next, 'layout', { status: 'complete', report });
  return { doc: output, report };
}

/** Stage 5: repair safe constraints, then produce a reviewable final report. */
export function reviewArticleStage(doc = {}, { autoFix = true } = {}) {
  let next = clone(doc);
  let optimization = null;
  if (autoFix) {
    optimization = optimizeWechatDocument(next);
    next = optimization.doc;
  }
  const article = inspectWechatArticle({
    title: next.title,
    author: next.author || '',
    digest: next.subtitle || '',
    content: renderArticleHtml(next)
  });
  const { asset: coverAsset } = imageAssetForCover(next);
  const conversionRequired = [...(next.assets || [])]
    .filter(asset => asset.dataUrl && !IMAGE_TYPES_ACCEPTED_BY_WECHAT.has(String(asset.type || '').toLowerCase()))
    .filter(asset => expectedWechatImageType(asset) === 'image/jpeg')
    .map(asset => asset.name || asset.id);
  const cover = coverAsset
    ? inspectWechatCover({
      width: coverAsset.width,
      height: coverAsset.height,
      bytes: coverAsset.size,
      type: expectedWechatImageType(coverAsset),
      main: coverAsset.coverMain || next.title || '',
      sub: coverAsset.coverSub || next.subtitle || ''
    })
    : null;
  const errors = [
    ...article.errors.map(item => ({ id: item.id, message: item.message })),
    ...(cover ? cover.errors.map(message => ({ id: 'titleImage', message })) : [{ id: 'titleImage', message: '未设置头条封面图，提交公众号草稿前必须设置封面' }])
  ];
  const layoutGuidance = getLayoutGuidance(next);
  const warnings = [
    ...(article.warnings || []),
    ...(cover?.warnings || []),
    ...layoutGuidance.filter(item => item.level === 'review' || item.level === 'warning').map(item => item.text)
  ];
  const readyForSubmit = errors.length === 0;
  const status = readyForSubmit ? (warnings.length ? 'needs-review' : 'passed') : 'blocked';
  const report = {
    status,
    readyForSubmit,
    checkedAt: now(),
    checks: {
      article: { ok: article.ok, fields: article.fields, errors: article.errors.map(item => item.message) },
      cover: cover ? { ok: cover.ok, fields: cover.fields, errors: cover.errors, warnings: cover.warnings } : { ok: false, fields: null, errors: ['未设置头条封面图'], warnings: [] }
    },
    errors,
    warnings: [...new Set(warnings)],
    safeFixes: optimization?.changes || [],
    conversionRequired,
    layoutGuidance: layoutGuidance.slice(0, 8),
    handoff: { accepted: readyForSubmit, from: 'review', to: 'submit' },
    localOnly: true
  };
  next.meta = {
    ...(next.meta || {}),
    workflowReview: report
  };
  const output = writeWorkflow(next, 'review', { status, report });
  return { doc: output, report, optimization };
}

/** Build the local payload that the existing submit adapter can send. */
export function prepareWorkflowSubmission(doc = {}) {
  const workflow = getWorkflowState(doc);
  const review = workflow.stages.review.report;
  const html = renderArticleHtml(doc);
  if (!review?.readyForSubmit) {
    return {
      ok: false,
      stage: 'review',
      error: review?.errors?.[0]?.message || '请先完成公众号审核',
      review,
      html
    };
  }
  return {
    ok: true,
    stage: 'submit',
    payload: {
      article_type: 'news',
      title: doc.title || '',
      author: doc.author || '',
      digest: doc.subtitle || '',
      content: html,
      content_source_url: ''
    },
    html,
    review
  };
}

/** Record the result of the local bundle or the explicit remote adapter. */
export function recordWorkflowSubmission(doc = {}, delivery = {}) {
  const status = delivery.status === 'submitted' ? 'submitted' : delivery.status === 'failed' ? 'failed' : 'ready';
  const report = {
    status,
    mode: delivery.mode || 'local-bundle',
    draftId: delivery.draftId || delivery.draft_media_id || null,
    error: delivery.error || null,
    nextAction: delivery.nextAction || null,
    remote: delivery.mode === 'wechat-api',
    at: now()
  };
  return writeWorkflow(doc, 'submit', { status, report }, { invalidateDownstream: false });
}

/**
 * Run stages 1–4 and prepare stage 5. Remote submission stays behind the
 * existing explicit adapter; this function therefore has no network side
 * effect and is safe for GUI, CLI and MCP callers.
 */
export function runPublishingWorkflow(input = {}, options = {}) {
  const recognized = input.doc
    ? (getWorkflowState(input.doc).stages.recognize.report
      ? { doc: clone(input.doc), report: getWorkflowState(input.doc).stages.recognize.report }
      : recognizeExistingDocumentStage(input.doc))
    : recognizeArticleStage(input);
  const requestedHumanizeMode = options.humanizeMode ?? options.humanize;
  const existingHumanize = getWorkflowState(recognized.doc).stages.humanize;
  let humanize;
  if (requestedHumanizeMode && String(requestedHumanizeMode).toLowerCase() !== 'off' && String(requestedHumanizeMode).toLowerCase() !== 'false') {
    humanize = humanizeArticleStage(recognized.doc, {
      mode: requestedHumanizeMode,
      apply: options.applyHumanize === true
    });
    if (humanize.report.status === 'needs-review') {
      return {
        doc: humanize.doc,
        reports: { recognize: recognized.report, humanize: humanize.report, distill: null, layout: null, review: null, submit: null },
        submission: { ok: false, stage: 'humanize', error: '自然化结果等待人工确认' },
        readyForSubmit: false,
        haltedAt: 'humanize',
        localOnly: true
      };
    }
  } else if (['needs-review', 'blocked', 'failed'].includes(existingHumanize.status)) {
    return {
      doc: recognized.doc,
      reports: { recognize: recognized.report, humanize: existingHumanize.report, distill: null, layout: null, review: null, submit: null },
      submission: { ok: false, stage: 'humanize', error: existingHumanize.report?.reason || '自然化阶段需要人工处理' },
      readyForSubmit: false,
      haltedAt: 'humanize',
      localOnly: true
    };
  } else if (existingHumanize.status === 'complete' && existingHumanize.report?.applied) {
    humanize = { doc: recognized.doc, report: existingHumanize.report };
  } else {
    humanize = skipHumanizeStage(recognized.doc);
  }
  const distill = distillArticleStage(humanize.doc, { applyTitleWhenMissing: options.applyTitleWhenMissing !== false });
  const layout = layoutArticleStage(distill.doc, {
    generateImages: options.generateImages !== false,
    maxGenerated: options.maxGenerated ?? 3,
    autoImageCount: options.autoImageCount !== false,
    coreThemeCount: options.coreThemeCount ?? 0
  });
  const review = reviewArticleStage(layout.doc, { autoFix: options.autoFix !== false });
  const submission = prepareWorkflowSubmission(review.doc);
  const doc = recordWorkflowSubmission(review.doc, { status: submission.ok ? 'ready' : 'failed', mode: 'local-bundle', error: submission.ok ? null : submission.error });
  return {
    doc,
    reports: { recognize: recognized.report, humanize: humanize.report, distill: distill.report, layout: layout.report, review: review.report, submit: getWorkflowState(doc).stages.submit.report },
    submission,
    readyForSubmit: submission.ok,
    localOnly: true
  };
}
