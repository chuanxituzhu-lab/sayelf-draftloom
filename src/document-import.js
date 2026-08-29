const ARTICLE_EXTENSIONS = Object.freeze(['.md', '.markdown', '.txt', '.docx', '.pdf']);

function extensionOf(fileOrName = '') {
  const name = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name || '';
  const dot = String(name).lastIndexOf('.');
  return dot >= 0 ? String(name).slice(dot).toLowerCase() : '';
}
export function getArticleFileKind(fileOrName = {}) {
  const extension = extensionOf(fileOrName);
  const type = typeof fileOrName === 'string' ? '' : String(fileOrName?.type || '').toLowerCase();
  if (['.md', '.markdown', '.txt'].includes(extension) || type.startsWith('text/')) return 'text';
  if (extension === '.docx' || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (extension === '.pdf' || type === 'application/pdf') return 'pdf';
  return null;
}

export function isSupportedArticleFile(fileOrName = {}) {
  return Boolean(getArticleFileKind(fileOrName));
}

export function supportedArticleExtensions() {
  return [...ARTICLE_EXTENSIONS];
}

/**
 * Remove presentation markers from imported article text while retaining words,
 * line breaks, and the structured blocks created by importArticle.
 */
export function sanitizeArticleText(value = '') {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[＊*＃#`]/g, '')
    .replace(/(?:__|~~)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeBlock(block = {}) {
  const next = { ...block };
  if (typeof next.text === 'string') next.text = sanitizeArticleText(next.text);
  if (Array.isArray(next.items)) {
    next.items = next.items.map(item => sanitizeArticleText(item)).filter(Boolean);
    next.text = next.items.join('\n');
  }
  if (Array.isArray(next.headers)) next.headers = next.headers.map(item => sanitizeArticleText(item));
  if (Array.isArray(next.rows)) next.rows = next.rows.map(row => row.map(item => sanitizeArticleText(item)));
  if (typeof next.buttonText === 'string') next.buttonText = sanitizeArticleText(next.buttonText);
  return next;
}

function sanitizeTitlePlan(plan) {
  if (!plan || typeof plan !== 'object') return plan;
  return {
    ...plan,
    selected: typeof plan.selected === 'string' ? sanitizeArticleText(plan.selected) : plan.selected,
    topic: typeof plan.topic === 'string' ? sanitizeArticleText(plan.topic) : plan.topic,
    summary: typeof plan.summary === 'string' ? sanitizeArticleText(plan.summary) : plan.summary,
    candidates: Array.isArray(plan.candidates)
      ? plan.candidates.map(candidate => ({
        ...candidate,
        title: typeof candidate.title === 'string' ? sanitizeArticleText(candidate.title) : candidate.title
      }))
      : plan.candidates
  };
}

export function sanitizeImportedDocument(document = {}) {
  const next = structuredClone(document);
  next.title = sanitizeArticleText(next.title);
  next.author = sanitizeArticleText(next.author);
  next.subtitle = sanitizeArticleText(next.subtitle);
  next.blocks = Array.isArray(next.blocks) ? next.blocks.map(sanitizeBlock) : [];
  if (next.meta?.titlePlan) next.meta.titlePlan = sanitizeTitlePlan(next.meta.titlePlan);
  if (next.meta?.visualPlan?.title) next.meta.visualPlan.title = sanitizeTitlePlan(next.meta.visualPlan.title);
  return next;
}
