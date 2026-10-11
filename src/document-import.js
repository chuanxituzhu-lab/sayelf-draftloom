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

function countTextCharacters(value = '') {
  return Array.from(String(value ?? '')).length;
}

const CORE_CONCEPT_GROUPS = Object.freeze([
  ['效率', '效能', '生产力'], ['问题', '难题', '困境', '痛点'], ['方法', '做法', '策略', '路径'],
  ['创作', '创造', '生成'], ['价值', '意义', '作用', '成果'], ['学习', '掌握', '理解', '认知'],
  ['应用', '落地', '实践'], ['成本', '开销', '代价']
]);
const CORE_PHRASE_STOP_WORDS = new Set([
  '这是', '可以', '因为', '所以', '如果', '通过', '进行', '一个', '我们', '他们', '自己', '然后', '文章', '内容', '真正',
  '需要', '非常', '起来', '没有', '这个', '那个', '一些', '对于', '同时', '能够', '应该', '已经', '不断', '更多', '这样',
  '大家', '之后', '开始', '今天', '首先', '其次', '最后', '读者', '从而', '并且', '但是', '而是', '不是', '因此', '成为',
  '值得', '本文', '一篇', '还有', '目前', '时候', '我们', '这个', '怎么', '什么', '如何'
]);
const CORE_CUES = /(?:核心|重点|观点|主题|关键|本质|意味着|决定|因此|真正|不是.{0,12}而是|只有.{0,16}才|需要|解决|结论|重要|效率|效能|价值|方法|问题|应用|实践|创造|创作|结果|改变|提升|降低|避免)/u;

function scoreCoreExcerpt(value = '', source = '', blockIndex = 0) {
  const text = String(value ?? '').trim();
  const length = countTextCharacters(text);
  let score = length >= 6 && length <= 20 ? 8 : length >= 4 && length <= 28 ? 5 : length >= 2 && length <= 32 ? 2 : -8;
  if (CORE_CUES.test(text)) score += 4;
  if (/(?:^(?:这是一篇|这是一段|本文|我们|大家|今天|现在)|首先|其次|最后|接下来|本文|今天我们|大家好|综上所述|总的来说)/u.test(text)) score -= 6;
  if (/(?:普通文章|提示词|没有.{0,8}(?:重点|提示))/u.test(text)) score -= 10;
  if (/(?:的|了|着|和|与|及|而|但|如果|因为|所以|因此)$/u.test(text)) score -= 3;
  if (text === String(source).trim() && length >= 12) score -= 14;
  for (const group of CORE_CONCEPT_GROUPS) {
    const sourceHits = group.reduce((count, term) => count + (String(source).split(term).length - 1), 0);
    if (sourceHits >= 2 && group.some(term => text.includes(term))) score += 3;
  }
  if (blockIndex === 0) score += 0.25;
  return score;
}

function addPhraseCandidate(candidates, text, start, source, blockIndex, sentenceScore = 0) {
  const phrase = String(text || '').trim();
  const leading = String(text || '').length - String(text || '').trimStart().length;
  const phraseStart = start + leading;
  const length = countTextCharacters(phrase);
  if (length < 2 || length > 32 || CORE_PHRASE_STOP_WORDS.has(phrase)) return;
  candidates.push({
    start: phraseStart,
    end: phraseStart + phrase.length,
    text: phrase,
    score: scoreCoreExcerpt(phrase, source, blockIndex) + sentenceScore
  });
}

function getHighlightCandidates(blocks = []) {
  const candidates = [];
  blocks.forEach((block, blockIndex) => {
    if (block?.type !== 'paragraph') return;
    const text = String(block.text || '');
    const sentences = [...text.matchAll(/[^。！？!?；;\n]+/gu)];
    for (const sentenceMatch of sentences) {
      const rawSentence = sentenceMatch[0];
      const sentenceOffset = sentenceMatch.index || 0;
      const sentence = rawSentence.trim();
      const sentenceStart = sentenceOffset + rawSentence.length - rawSentence.trimStart().length;
      if (countTextCharacters(sentence) < 2) continue;
      const sentenceScore = CORE_CUES.test(sentence) ? 2 : 0;
      const clauses = [...sentence.matchAll(/[^，,、：:；;—–]+/gu)];
      for (const clauseMatch of clauses) {
        const clause = clauseMatch[0];
        const clauseStart = sentenceStart + (clauseMatch.index || 0);
        const clauseLength = countTextCharacters(clause.trim());
        if (clauseLength <= 32) {
          addPhraseCandidate(candidates, clause, clauseStart, text, blockIndex, sentenceScore);
          continue;
        }
        // Split long clauses at common local discourse connectors, then use only
        // verbatim fragments from the source; no generated paraphrase is marked.
        const connectorPattern = /而不是|不是|而是|因此|所以|因为|才能|可以|能够|需要|应该|同时|并且|但是|但|让|使|从而/gu;
        let cursor = 0;
        for (const connector of clause.matchAll(connectorPattern)) {
          const before = clause.slice(cursor, connector.index);
          addPhraseCandidate(candidates, before, clauseStart + cursor, text, blockIndex, sentenceScore);
          cursor = connector.index + connector[0].length;
        }
        addPhraseCandidate(candidates, clause.slice(cursor), clauseStart + cursor, text, blockIndex, sentenceScore);
      }

      // If the paragraph has no useful clause boundaries, retain an exact
      // content word/phrase as a safe fallback rather than coloring a whole block.
      const chineseRuns = [...sentence.matchAll(/[\u4e00-\u9fff]{2,}/gu)];
      for (const run of chineseRuns) {
        const runText = run[0];
        const chars = Array.from(runText);
        for (let size = Math.min(6, chars.length); size >= 2; size -= 1) {
          for (let offset = 0; offset <= chars.length - size; offset += 1) {
            const term = chars.slice(offset, offset + size).join('');
            if (CORE_PHRASE_STOP_WORDS.has(term)) continue;
            const termStart = sentenceStart + (run.index || 0) + offset;
            const occurrences = String(text).split(term).length - 1;
            const coreTerm = CORE_CUES.test(term) || CORE_CONCEPT_GROUPS.some(group => group.some(alias => term.includes(alias)));
            const repeatedConcept = CORE_CONCEPT_GROUPS.some(group => group.some(alias => text.includes(alias)) && group.filter(alias => text.includes(alias)).length > 1 && group.some(alias => term.includes(alias)));
            candidates.push({ start: termStart, end: termStart + term.length, text: term, score: 3 + Math.min(size, 6) * 0.6 + (coreTerm ? 4 : 0) + (repeatedConcept ? 3 : 0) + Math.min(occurrences - 1, 2) * 2 + sentenceScore });
          }
        }
      }
      for (const english of sentence.matchAll(/[A-Za-z][A-Za-z0-9+#.-]{1,}/gu)) {
        const term = english[0];
        const termStart = sentenceStart + (english.index || 0);
        const occurrences = String(text).toLowerCase().split(term.toLowerCase()).length - 1;
        candidates.push({ start: termStart, end: termStart + term.length, text: term, score: 5 + Math.min(term.length, 8) * 0.45 + (occurrences > 1 ? 3 : 0) + sentenceScore });
      }
    }
  });
  return candidates
    .filter(candidate => candidate.end > candidate.start)
    .sort((a, b) => b.score - a.score || a.start - b.start);
}

function addArticleFallbackHighlight(blocks = []) {
  return blocks.map(block => {
    if (block?.type !== 'paragraph') return block;
    const existingRanges = Array.isArray(block.emphasisRanges) ? block.emphasisRanges : [];
    if (existingRanges.some(range => range.style === 'mark' && range.end > range.start)) return block;
    const candidate = getHighlightCandidates([{ ...block, type: 'paragraph' }])[0];
    const targetText = String(block.text || '');
    if (!candidate || candidate.end > targetText.length) return block;
    return {
      ...block,
      emphasis: 'inline',
      emphasisLabel: '段落核心',
      emphasisRanges: normalizeEmphasisRanges([...existingRanges, { start: candidate.start, end: candidate.end, style: 'mark' }], targetText.length),
      emphasisSource: 'auto',
      emphasisFallback: true
    };
  });
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
    if (sentenceLength >= 2 && sentenceLength <= 120) {
      const core = getHighlightCandidates([{ type: 'paragraph', text: remainder.slice(0, sentenceLength) }])[0];
      if (core) addRange(sentenceStart + core.start, sentenceStart + core.end, 'mark');
    }
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
    const quotedText = match[0].slice(1, -1);
    const core = getHighlightCandidates([{ type: 'paragraph', text: quotedText }])[0];
    if (core) addRange(match.index + 1 + core.start, match.index + 1 + core.end, 'mark');
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
  next.title = sanitizeArticleText(next.title);
  next.author = sanitizeArticleText(next.author);
  next.subtitle = sanitizeArticleText(next.subtitle);
  next.blocks = Array.isArray(next.blocks) ? next.blocks.map(block => {
    block = sanitizeBlock(block);
    if (!['paragraph', 'heading'].includes(block?.type)) {
      if (block?.emphasisSource !== 'auto' || !block?.emphasisFallback) return block;
      const cleaned = { ...block };
      delete cleaned.emphasis;
      delete cleaned.emphasisLabel;
      delete cleaned.emphasisRanges;
      delete cleaned.emphasisSource;
      delete cleaned.emphasisFallback;
      delete cleaned.emphasisItemIndex;
      return cleaned;
    }
    const detected = detectArticleEmphasis(block.text, { type: block.type });
    if (detected) {
      const refreshed = { ...block, emphasis: detected.style, emphasisLabel: detected.label, emphasisRanges: detected.ranges, emphasisSource: 'auto' };
      delete refreshed.emphasisFallback;
      delete refreshed.emphasisItemIndex;
      return refreshed;
    }
    if (block.emphasisSource !== 'auto') return block;
    const cleaned = { ...block };
    delete cleaned.emphasis;
    delete cleaned.emphasisLabel;
    delete cleaned.emphasisRanges;
    delete cleaned.emphasisSource;
    delete cleaned.emphasisFallback;
    delete cleaned.emphasisItemIndex;
    return cleaned;
  }) : [];
  next.blocks = addArticleFallbackHighlight(next.blocks);
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
    .replace(/^\s*`{3,}[^\n]*$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*{3}([^*\n]+)\*{3}/g, '$1')
    .replace(/\*{2}([^*\n]+)\*{2}/g, '$1')
    // Truncated summaries and split blocks can leave unmatched bold delimiters.
    .replace(/\*{2,}/g, '')
    .replace(/(^|[\s([{（])\*([^*\n]+)\*(?=$|[\s)\]}），。！？；;:：])/gm, '$1$2')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
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
