const ARTICLE_EXTENSIONS = Object.freeze(['.md', '.markdown', '.txt', '.docx', '.pdf']);

/** Normalizes a text source before it enters the shared Markdown pipeline. */
export function normalizeArticleMarkdown(value = '') {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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

const CHINESE_NUMBER = '[一二三四五六七八九十百千万零〇两]+';
const SECTION_NUMBER = `(?:N|\\d+|${CHINESE_NUMBER})`;

function normalizeEmphasisRanges(ranges = [], length = 0) {
  const ordered = ranges
    .map(range => ({
      start: Math.max(0, Math.min(length, Number(range.start) || 0)),
      end: Math.max(0, Math.min(length, Number(range.end) || 0)),
      style: range.style === 'mark' ? 'mark' : 'strong'
    }))
    .filter(range => range.end > range.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const result = [];
  let cursor = 0;
  for (const range of ordered) {
    if (range.start < cursor) continue;
    result.push(range);
    cursor = range.end;
  }
  return result;
}

/** Detect local editorial signals and return only the text ranges to emphasize. */
export function detectArticleEmphasis(value = '', options = {}) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const ranges = [];
  let label = '';
  const addRange = (start, end, style = 'strong') => ranges.push({ start, end, style });
  const markerBoundary = '(?:^|[。！？!?；;\\n])\\s*';

  if (options.type === 'heading') {
    return { style: 'inline', label: '标题', ranges: [{ start: 0, end: text.length, style: 'strong' }] };
  }

  const importantPattern = new RegExp(`${markerBoundary}(?:【\\s*)?(重点|重要提示|特别提醒|核心(?:观点|结论|内容)?|关键(?:是|在于)?)(?:\\s*】)?(\\s*[：:])?`, 'gi');
  for (const match of text.matchAll(importantPattern)) {
    if (!label) label = '重点';
    const full = match[0];
    const marker = match[1];
    const markerStart = match.index + full.indexOf(marker);
    addRange(markerStart, markerStart + marker.length, 'strong');
    if (!match[2]) continue;
    const sentenceStart = match.index + full.length;
    const remainder = text.slice(sentenceStart);
    const endOffset = remainder.search(/[。！？!?；;\\n]/);
    const sentenceLength = endOffset >= 2 ? endOffset : remainder.length <= 80 ? remainder.length : -1;
    if (sentenceLength >= 2 && sentenceLength <= 120) addRange(sentenceStart, sentenceStart + sentenceLength, 'mark');
  }

  const sectionPattern = new RegExp(`${markerBoundary}(第\\s*${SECTION_NUMBER}\\s*(?:[章节部分条点步项篇回期])?)`, 'gi');
  for (const match of text.matchAll(sectionPattern)) {
    if (!label) label = '章节';
    const full = match[0];
    const marker = match[1];
    const markerStart = match.index + full.indexOf(marker);
    addRange(markerStart, markerStart + marker.length, 'strong');
  }

  const rangePattern = new RegExp(`${markerBoundary}((?:${CHINESE_NUMBER}|\\d+)\\s*[~～—-]\\s*${SECTION_NUMBER})`, 'gi');
  for (const match of text.matchAll(rangePattern)) {
    if (!label) label = '范围';
    const full = match[0];
    const marker = match[1];
    const markerStart = match.index + full.indexOf(marker);
    addRange(markerStart, markerStart + marker.length, 'strong');
  }

  const numberPattern = new RegExp(`${markerBoundary}(0?\\d{1,2})(?=[.)、:：\\s]|$)`, 'g');
  for (const match of text.matchAll(numberPattern)) {
    if (!label) label = '编号';
    const full = match[0];
    const marker = match[1];
    const markerStart = match.index + full.indexOf(marker);
    addRange(markerStart, markerStart + marker.length, 'strong');
  }

  for (const match of text.matchAll(/[“「『"][^”」』"]{8,80}[”」』"]/g)) {
    if (!label) label = '金句';
    addRange(match.index, match.index + match[0].length, 'mark');
  }
  for (const match of text.matchAll(/核心(?:内容|观点|结论)?|关键/g)) {
    if (!label) label = '核心';
    addRange(match.index, match.index + match[0].length, 'strong');
  }

  const normalized = normalizeEmphasisRanges(ranges, text.length);
  if (!normalized.length) return null;
  return { style: 'inline', label: label || (normalized.some(range => range.style === 'mark') ? '金句' : '重点'), ranges: normalized };
}

export function applyArticleEmphasis(document = {}) {
  const next = structuredClone(document);
  next.blocks = Array.isArray(next.blocks) ? next.blocks.map(block => {
    if (!['paragraph', 'heading'].includes(block?.type)) return block;
    const detected = detectArticleEmphasis(block.text, { type: block.type });
    if (detected) return { ...block, emphasis: detected.style, emphasisLabel: detected.label, emphasisRanges: detected.ranges, emphasisSource: 'auto' };
    if (block.emphasisSource !== 'auto') return block;
    const cleaned = { ...block };
    delete cleaned.emphasis;
    delete cleaned.emphasisLabel;
    delete cleaned.emphasisRanges;
    delete cleaned.emphasisSource;
    return cleaned;
  }) : [];
  return next;
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
  return applyArticleEmphasis(next);
}
