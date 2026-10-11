import { TECH_TOPICS, topicMentioned, verifiedTopics } from './tech-topics.js';
// Local-first visual planning for WeChat articles.
//
// The planner deliberately has no network dependency. It produces a stable
// visual brief and SVG fallback assets, while keeping the provider seam open
// for a future image-generation adapter. Generated blocks are marked so a
// human can replace or delete them without losing the original article.

import { WECHAT_LIMITS } from './wechat-limits.js';

const DEFAULT_TITLE = /^(未命名公众号文章|未命名文章|新文章)$/;
const DEFAULT_SUBTITLE = '自动排版草稿 · 可继续人工编辑';
const STOP_WORDS = new Set([
  '我们', '你们', '他们', '这个', '那个', '这些', '那些', '可以', '进行', '一个', '一种', '因为', '所以',
  '如果', '已经', '通过', '内容', '文章', '然后', '以及', '关于', '什么', '如何', '就是', '自己', '没有',
  '图片', '图像', '素材', '章节', '部分', '第一', '第二', '自动', '填充', '以后', '为什么', '很多人', '这一点', '别人', '还是',
  'with', 'from', 'that', 'this', 'the', 'and', 'for', 'are', 'you', 'your'
]);
const CORE_SIGNAL_TERMS = Object.freeze([
  '本质', '核心', '关键', '重要', '所以', '因此', '真正', '价值', '方法', '执行', '意味着', '结论', '不是', 'AI',
  '问题', '痛点', '困境', '难点', '限制', '误区', '步骤', '建议', '通过', '采用', '决定', '才能', '总结'
]);
const CORE_CONTENT_TYPES = Object.freeze(['TOPIC', 'PROBLEM', 'METHOD', 'CONCLUSION']);
const CORE_TYPE_TERMS = Object.freeze({
  PROBLEM: Object.freeze(['问题', '痛点', '困境', '难点', '限制', '误区', '不足', '缺少', '挑战', '风险', '难以', '无法', '为何', '为什么']),
  METHOD: Object.freeze(['方法', '步骤', '建议', '做法', '通过', '采用', '流程', '策略', '路径', '实践', '执行', '先', '再', '最后']),
  CONCLUSION: Object.freeze(['因此', '所以', '最终', '意味着', '结论', '本质', '关键', '真正', '价值', '决定', '才能', '只有', '不是', '而是', '总结', '说明'])
});

const PALETTES = Object.freeze({
  minimal: { bg: '#eef6f2', ink: '#153b2e', accent: '#1f9d72', soft: '#a9dfc7' },
  editorial: { bg: '#f7eee5', ink: '#4c3022', accent: '#a8683e', soft: '#e2baa0' },
  fresh: { bg: '#eaf8f8', ink: '#174650', accent: '#218a9b', soft: '#a9dfe2' },
  ink: { bg: '#f2effb', ink: '#302745', accent: '#7657b8', soft: '#c8bce8' },
  sunset: { bg: '#fff0e7', ink: '#4a2a22', accent: '#e45f3f', soft: '#f4c2a1' },
  official: { bg: '#17201b', ink: '#e8eeeb', accent: '#19d875', soft: '#26362d' },
  ralInspired: { bg: '#edf2e8', ink: '#26362a', accent: '#567d46', soft: '#c4d3ad' }
});

function clone(value) { return structuredClone(value); }
function textOfBlock(block = {}) { return block.text || (block.items || []).join('，') || ''; }
function clean(value = '') { return String(value).replace(/\s+/g, ' ').trim(); }
function truncate(value, max = 32) {
  const chars = [...clean(value)];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
}
const TITLE_SUGGESTION_PREFERRED_CHARS = 16;
function conciseTitleFromEvidence(sentence) {
  let title = clean(sentence)
    .replace(/^(?:总的来说|综上所述|值得注意的是|需要注意的是|一个现实问题是|结论是|总之|因此|所以)[，,：:\s]*/, '')
    .replace(/[。！？!?；;]+$/, '')
    .trim();

  // Reorder two common conclusion forms without adding claims beyond the evidence.
  title = title
    .replace(/([A-Za-z0-9])\s+(?=[\u4e00-\u9fff])/g, '$1')
    .replace(/^真正决定(.+?)的[，,：:]是(.+)$/, (_match, outcome, reason) => {
      const compactReason = reason.replace(/清晰的|明确的/g, match => match.slice(0, -1)).replace(/人的/g, '');
      return `${compactReason}决定${outcome}`;
    })
    .replace(/^(.+?)可以帮助(?:人们|大家)?(解决|完成|处理|减少|增加|降低|提升|避免)(.+)$/, '$1能$2$3')
    .replace(/^(.+?)越来越多[，,：:]真正(.+?)的却未必越来越多$/, '$1越多，$2未必越多');

  const isCompleteClause = clause => {
    const value = clean(clause);
    return [...value].length >= 4
      && [...value].length <= TITLE_SUGGESTION_PREFERRED_CHARS
      && !/^[，,：:；;、]|^(?:而且|但是|不过|所以|因此|并且|同时|如果|因为|例如|比如)/.test(value)
      && !/(?:读者可以自行思考|可以自行思考|值得关注|值得一看|值得分享|继续探索|引发思考)/.test(value)
      && !/[的是和与但却而在为把被将能可需应让的了着过及或]$/.test(value)
      && /决定|解决|影响|取决|意味着|说明|方法|结果|选择|需要|应该|才能|可以|未必|应用|改变|带来|降低|提升|避免|成为|形成|实现|增加|减少|越多|越少|不再|不是|而是|是|有|能|会|让|用/.test(value);
  };

  if (isCompleteClause(title)) return title;

  // Prefer a complete, conclusion-bearing clause over cutting a sentence mid-thought.
  const clauses = title.split(/[，,：:；;—–]/).map(clean).filter(isCompleteClause);
  const signals = /结论|决定|解决|关键|核心|需要|应该|才能|可以|未必|影响|取决|意味着|说明|方法|结果|选择|不/;
  clauses.sort((a, b) => {
    const aScore = (signals.test(a) ? 6 : 0) + Math.min([...a].length, 16) - Math.abs([...a].length - 14) * 0.2;
    const bScore = (signals.test(b) ? 6 : 0) + Math.min([...b].length, 16) - Math.abs([...b].length - 14) * 0.2;
    return bScore - aScore;
  });
  return clauses[0] || '';
}
function escapeXml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}
function randomId() { return globalThis.crypto?.randomUUID?.() || `visual-${Date.now()}-${Math.random().toString(16).slice(2)}`; }

/** Extracts repeatable topic words without requiring an LLM or network. */
export function extractKeywords(text = '', max = 8) {
  const counts = new Map();
  const source = String(text).toLowerCase();
  const tokens = source.match(/[\u4e00-\u9fff]{2,8}|[a-z][a-z0-9-]{2,}/gi) || [];
  for (const raw of tokens) {
    const token = raw.trim();
    if (!token || STOP_WORDS.has(token) || token.length < 2) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
    // Long Chinese phrases also contribute their meaningful 2–4 character
    // windows, which makes matching image filenames such as “山野茶.jpg” useful.
    if (/^[\u4e00-\u9fff]+$/.test(token) && token.length > 4) {
      for (let size = 2; size <= 4; size += 1) {
        for (let index = 0; index <= token.length - size; index += 1) {
          const part = token.slice(index, index + size);
          if (!STOP_WORDS.has(part)) counts.set(part, (counts.get(part) || 0) + 0.25);
        }
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([word]) => word);
}
function coreSentenceType(sentence = '') {
  const value = clean(sentence);
  if (!value) return 'TOPIC';
  if (/[？?]/.test(value) || CORE_TYPE_TERMS.PROBLEM.some(term => value.includes(term))) return 'PROBLEM';
  if (CORE_TYPE_TERMS.METHOD.some(term => value.includes(term))) return 'METHOD';
  if (CORE_TYPE_TERMS.CONCLUSION.some(term => value.includes(term))) return 'CONCLUSION';
  return 'TOPIC';
}
function nullableSentence(value) {
  const sentence = clean(value);
  return sentence || null;
}
function normalizeKeySentence(item = {}, index = 0) {
  const sentence = clean(item.sentence || item.text || '');
  if (!sentence) return null;
  const type = CORE_CONTENT_TYPES.includes(item.type) ? item.type : coreSentenceType(sentence);
  const position = Number.isInteger(item.index) ? item.index : index;
  return { type, sentence, index: Math.max(0, position) };
}

/** Normalizes the local CoreContent contract for deterministic and future harness output. */
export function normalizeCoreContent(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const keySentences = (Array.isArray(source.keySentences) ? source.keySentences : [])
    .map(normalizeKeySentence)
    .filter(Boolean);
  const points = (Array.isArray(source.points) ? source.points : keySentences.map(item => item.sentence))
    .map(clean)
    .filter(Boolean);
  return {
    type: 'CoreContent',
    version: 1,
    source: clean(source.source) || 'local-deterministic',
    epistemic: 'inference',
    localOnly: true,
    thesis: clean(source.thesis),
    topic: clean(source.topic),
    problem: nullableSentence(source.problem),
    method: nullableSentence(source.method),
    conclusion: nullableSentence(source.conclusion),
    keywords: [...new Set((Array.isArray(source.keywords) ? source.keywords : []).map(clean).filter(Boolean))].slice(0, 8),
    keySentences,
    summary: clean(source.summary),
    points,
    generatedAt: clean(source.generatedAt) || new Date().toISOString()
  };
}

/** Validates the handoff boundary without treating local inference as verified fact. */
export function validateCoreContent(core = {}) {
  const errors = [];
  if (core?.type !== 'CoreContent') errors.push('type 必须为 CoreContent');
  if (core?.version !== 1) errors.push('version 必须为 1');
  if (!clean(core?.source)) errors.push('缺少提炼来源');
  if (core?.epistemic !== 'inference') errors.push('epistemic 必须为 inference');
  if (core?.localOnly !== true) errors.push('localOnly 必须为 true');
  if (!clean(core?.thesis)) errors.push('缺少 thesis 核心观点');
  if (!clean(core?.topic)) errors.push('缺少 topic 主题');
  if (!Array.isArray(core?.keywords)) errors.push('keywords 必须为数组');
  if (!Array.isArray(core?.keySentences) || core.keySentences.length < 1) errors.push('至少需要一条 keySentences 证据句');
  for (const item of core?.keySentences || []) {
    if (!CORE_CONTENT_TYPES.includes(item?.type)) errors.push('keySentences 存在未知类型');
    if (!clean(item?.sentence)) errors.push('keySentences 存在空句子');
    if (!Number.isInteger(item?.index) || item.index < 0) errors.push('keySentences index 必须为非负整数');
  }
  return { ok: errors.length === 0, errors, bodyRewritten: false, requiresReview: true, localOnly: core?.localOnly === true };
}

function normalizeHashtag(value = '') {
  const normalized = clean(String(value).replace(/^#+/, ''))
    .replace(/[^\u4e00-\u9fffA-Za-z0-9_-]/g, '')
    .trim();
  if (!normalized || normalized.length < 2 || STOP_WORDS.has(normalized.toLowerCase())) return '';
  return normalized;
}

/**
 * Builds customer-facing article keywords and copy-ready hashtags locally.
 * The result is a recommendation, not a claim about the article's facts.
 */
export function generateArticleKeywords({ title = '', text = '', existingKeywords = [], topicEvidence = null, max = 8 } = {}) {
  const source = `${title}\n${text}`;
  const mentioned = TECH_TOPICS.filter(topic => topicMentioned(source, topic)).map(topic => topic.keyword);
  const corroborated = new Set(verifiedTopics(topicEvidence).map(topic => topic.keyword));
  const extracted = extractKeywords(source, Math.max(12, Number(max) * 2 || 16));
  const provided = Array.isArray(existingKeywords) ? existingKeywords : [];
  const titleTerms = String(title).match(/[\u4e00-\u9fff]{2,12}|[a-z][a-z0-9-]{2,}/gi) || [];
  const shortEnglishTerms = source.match(/\b[A-Z]{2,}\b/g) || [];
  const candidates = [...mentioned, ...titleTerms, ...shortEnglishTerms, ...provided, ...extracted]
    .map(normalizeHashtag)
    .filter(Boolean).map(term => mentioned.find(name => name.toLowerCase() === term.toLowerCase()) || term);
  const sourceLower = source.toLowerCase();
  const keywords = [...new Set(candidates)]
    .sort((a, b) => {
      const aTech = mentioned.includes(a) ? (corroborated.has(a) ? 2 : 1) : 0;
      const bTech = mentioned.includes(b) ? (corroborated.has(b) ? 2 : 1) : 0;
      if (aTech !== bTech) return bTech - aTech;
      const aHits = sourceLower.split(a.toLowerCase()).length - 1;
      const bHits = sourceLower.split(b.toLowerCase()).length - 1;
      return bHits - aHits || b.length - a.length || a.localeCompare(b);
    })
    .slice(0, Math.max(1, Math.min(12, Number(max) || 8)));
  return {
    keywords,
    hashtags: keywords.map(keyword => `#${keyword}`),
    text: keywords.map(keyword => `#${keyword}`).join(' '),
    source: 'local-deterministic',
    generatedAt: new Date().toISOString()
  };
}

const HOT_TOPIC_RULES = Object.freeze([
  { label: '人工智能与工具', terms: ['ai', '人工智能', '大模型', '智能体', '生成式', '自动化', 'skill'] },
  { label: '内容创作与平台', terms: ['内容', '创作', '自媒体', '短视频', '平台', '标题', '脚本', '作品', 'idea'] },
  { label: '教育与职业', terms: ['教育', '学习', '课程', '老师', '就业', '职场', '职业', '技能'] },
  { label: '心理与成长', terms: ['心理', '情绪', '成长', '关系', '亲子', '沟通', '自我'] },
  { label: '科技与产业', terms: ['科技', '数据', '汽车', '芯片', '机器人', '产业', '产品'] },
  { label: '生活方式', terms: ['生活', '自然', '健康', '旅行', '茶', '美食', '消费'] }
]);

function escapeRegExp(value = '') { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function hasTopicTerm(text = '', term = '') {
  const value = String(text).toLowerCase();
  const candidate = String(term).toLowerCase();
  if (!candidate) return false;
  if (/^[a-z0-9-]+$/i.test(candidate)) return new RegExp(`\\b${escapeRegExp(candidate)}\\b`, 'i').test(value);
  return value.includes(candidate);
}
function parseHotTopics(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[,，、;；\n|]+|(?=#)/);
  return [...new Set(values.map(item => clean(String(item).replace(/^#+/, '').replace(/[“”"'`]/g, ''))).filter(Boolean))].slice(0, 30);
}

/**
 * Evaluates whether article keywords can be connected to a user-provided
 * hot-topic list. Without that list it deliberately reports an unverified
 * local semantic hint instead of pretending to know a live hot search.
 */
export function evaluateHotTopicFit({ title = '', text = '', keywords = [], hotTopics = [], topicEvidence = null, max = 8 } = {}) {
  const verified = verifiedTopics(topicEvidence);
  const plan = generateArticleKeywords({ title, text, existingKeywords: keywords, topicEvidence, max });
  const source = `${title}\n${text}`;
  const topics = parseHotTopics([...parseHotTopics(hotTopics), ...verified.map(topic => topic.keyword)]);
  const articleRules = HOT_TOPIC_RULES.filter(rule => rule.terms.some(term => hasTopicTerm(source, term)));
  const directHotTopics = topics.filter(topic => hasTopicTerm(source, topic));
  const assessments = plan.keywords.map(keyword => {
    const keywordLower = keyword.toLowerCase();
    const exactTopics = topics.filter(topic => {
      const topicLower = topic.toLowerCase();
      return topicLower.includes(keywordLower) || keywordLower.includes(topicLower);
    });
    const keywordRules = HOT_TOPIC_RULES.filter(rule => rule.terms.some(term => hasTopicTerm(keyword, term)));
    const relatedTopics = topics.filter(topic => keywordRules.some(rule => rule.terms.some(term => hasTopicTerm(topic, term))));
    if (!topics.length) return { keyword, relation: 'unknown', label: '待核验', advice: '尚无通过多源核实的热词，先按文章主题保留。', relatedTopics: [] };
    if (exactTopics.length) return { keyword, relation: 'strong', label: '强关联', advice: '可以合理借势，但正文要有对应事实或观点。', relatedTopics: exactTopics };
    if (relatedTopics.length) return { keyword, relation: 'adjacent', label: '可借势', advice: '有主题交集，建议从文章自身观点切入，不要硬塞热词。', relatedTopics };
    return { keyword, relation: 'weak', label: '不建议', advice: '正文缺少直接支撑，不建议为了热点强行添加。', relatedTopics: [] };
  });
  const matchedTopics = [...new Set([...directHotTopics, ...assessments.flatMap(item => item.relatedTopics)])];
  const strongCount = assessments.filter(item => item.relation === 'strong').length + directHotTopics.length;
  const adjacentCount = assessments.filter(item => item.relation === 'adjacent').length;
  let level = 'unknown';
  let decision = '待核验实时热榜';
  let note = articleRules.length
    ? `文章包含${articleRules.map(rule => rule.label).join('、')}等主题信号；粘贴今日热词后再判断是否适合借势。`
    : '当前只按文章语义生成关键词，尚未核验实时热榜，不把泛词当成热点。';
  if (topics.length && strongCount) {
    level = 'strong';
    decision = '可合理借势';
    note = `已发现 ${matchedTopics.length} 个有主题交集的热词，建议围绕正文已有事实或观点展开，不为蹭热点改写内容。`;
  } else if (topics.length && adjacentCount) {
    level = 'adjacent';
    decision = '谨慎借势';
    note = '文章与输入热词存在主题交集，但不是直接关联；建议明确切入角度后再使用。';
  } else if (topics.length) {
    level = 'weak';
    decision = '不建议硬蹭';
    note = '当前文章关键词与输入热词缺少直接支撑，不建议为了流量强行添加。';
  }
  if (topicEvidence?.checkedAt && !verified.length) {
    decision = '检索完成 · 证据不足或需更新';
    note = '当前检索证据不足或已过期，尚无通过多源核实的科技热词。保留文章自身关键词，可查看下方来源或重新检索。';
  }
  return {
    ...plan,
    hotTopics: topics,
    verified: verified.length > 0,
    verificationLabel: verified.length ? '近期新闻多源关注 · 非公众号热榜' : '未核实热度（手工输入也需核实）',
    level,
    decision,
    score: topics.length ? Math.min(100, strongCount * 25 + adjacentCount * 12) : null,
    matchedTopics,
    articleTopics: articleRules.map(rule => rule.label),
    assessments,
    note
  };
}

function articleSource(doc = {}) {
  return doc.original?.text || (doc.blocks || []).map(textOfBlock).filter(Boolean).join('\n');
}

/** Derives a WeChat-safe title while preserving an explicitly edited title. */
export function deriveArticleTitle({ text = '', filename = '', currentTitle = '' } = {}) {
  const current = clean(currentTitle);
  if (current && !DEFAULT_TITLE.test(current)) return { title: truncate(current), confidence: 1, source: 'existing' };
  const lines = String(text).replace(/^---[\s\S]*?---\s*/m, '').split(/\r?\n/).map(clean).filter(Boolean);
  const heading = lines.find(line => /^#{1,2}\s+/.test(line));
  const headingValue = heading?.replace(/^#{1,2}\s+/, '').trim();
  if (headingValue) return { title: truncate(headingValue), confidence: 0.95, source: 'heading' };
  const candidate = lines.find(line => !/^!\[/.test(line) && !/^[-*>|]/.test(line) && line.length >= 4);
  if (candidate) {
    const sentence = candidate.split(/[。！？!?]/)[0].trim();
    if (sentence.length >= 4) return { title: truncate(sentence), confidence: 0.82, source: 'opening' };
  }
  const keywords = extractKeywords(`${text} ${filename}`, 3);
  if (keywords.length) return { title: truncate(`${keywords.join(' · ')}：值得慢读的真实记录`), confidence: 0.56, source: 'keywords' };
  const fallback = clean(filename).replace(/\.[^.]+$/, '') || '未命名公众号文章';
  return { title: truncate(fallback), confidence: 0.35, source: 'filename' };
}

export function deriveArticleSubtitle({ text = '', currentSubtitle = '' } = {}) {
  const current = clean(currentSubtitle);
  if (current && current !== DEFAULT_SUBTITLE) return current;
  return extractCoreContent({ text, max: 64 }).summary || DEFAULT_SUBTITLE;
}

function plainArticleText(value = '') {
  return String(value)
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^\s{0,3}#{1,6}\s+.+$/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Selects evidence-bearing sentences locally for a human-reviewable core summary. */
export function extractCoreContent({ text = '', title = '', max = 88, maxPoints = 3 } = {}) {
  const source = plainArticleText(text);
  const currentTitle = clean(title);
  const body = currentTitle && source.startsWith(currentTitle) ? source.slice(currentTitle.length).trim() : source;
  const sentences = body.split(/(?<=[。！？!?；;])\s*/).map(clean).filter(item => item.length >= 8);
  const classified = sentences.map((sentence, index) => ({
    sentence,
    index,
    type: coreSentenceType(sentence),
    score: CORE_SIGNAL_TERMS.reduce((score, term) => score + (sentence.includes(term) ? 1 : 0), 0) + (index === 0 ? 0.35 : 0)
  }));
  const ranked = [...classified].sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = (ranked.length ? ranked : [{ sentence: clean(title) || source, index: 0, score: 0 }])
    .slice(0, Math.max(1, Math.min(5, Number(maxPoints) || 3)))
    .sort((a, b) => a.index - b.index)
    .filter(item => item.sentence);
  const fallback = currentTitle || body;
  const evidence = selected.map((item, index) => normalizeKeySentence(item, index));
  const allEvidence = classified.map((item, index) => normalizeKeySentence(item, index));
  if (!evidence.length) evidence.push(normalizeKeySentence({ sentence: fallback || '围绕文章主题提炼一个清晰、可读、值得继续阅读的观点。', index: 0 }, 0));
  const firstOfType = type => allEvidence.find(item => item?.type === type) || evidence.find(item => item?.type === type) || null;
  const topicEvidence = firstOfType('TOPIC') || allEvidence[0] || evidence[0];
  const thesisEvidence = firstOfType('CONCLUSION') || firstOfType('METHOD') || topicEvidence || evidence[0];
  const summary = truncate(evidence.slice(0, 2).map(item => item.sentence).join(' ') || fallback || '围绕文章主题提炼一个清晰、可读、值得继续阅读的观点。', max);
  return normalizeCoreContent({
    thesis: thesisEvidence?.sentence || summary,
    topic: topicEvidence?.sentence || thesisEvidence?.sentence || summary,
    problem: firstOfType('PROBLEM')?.sentence,
    method: firstOfType('METHOD')?.sentence,
    conclusion: firstOfType('CONCLUSION')?.sentence,
    keywords: extractKeywords(body, 6),
    keySentences: evidence,
    summary,
    points: evidence.map(item => truncate(item.sentence, 54)),
    source: 'local-deterministic',
    generatedAt: new Date().toISOString()
  });
}

/** Returns a short, deterministic summary that can be shown before a title is applied. */
export function summarizeArticle({ text = '', title = '', max = 88 } = {}) {
  return extractCoreContent({ text, title, max }).summary;
}

function titleTopic({ text = '', filename = '', keywords = [], profile = {} } = {}) {
  const profileKeywords = Array.isArray(profile.targetKeywords)
    ? profile.targetKeywords.map(clean).filter(Boolean)
    : String(profile.targetKeywords || '').split(/[,，、\n]/).map(clean).filter(Boolean);
  const heading = String(text).match(/^\s*#{1,2}\s+(.+?)\s*$/m)?.[1] || '';
  const headingTopic = clean(heading.split(/[：:|｜]/)[0]);
  const headingKeywords = extractKeywords(heading, 6);
  const all = [...new Set([headingTopic, ...profileKeywords, ...headingKeywords, ...keywords, ...extractKeywords(text, 8)].filter(Boolean))];
  const topic = all.find(item => item.length >= 3) || all[0];
  if (topic) return truncate(topic, 12);
  return truncate(clean(filename).replace(/\.[^.]+$/, '') || '这篇文章', 12);
}

/** Build concise, conclusion-first title hooks from sentences in the article. */
export function generateViralTitlePlan({ text = '', filename = '', currentTitle = '', keywords = [], profile = {}, limit = 5 } = {}) {
  const source = plainArticleText(text);
  const body = currentTitle && source.startsWith(clean(currentTitle)) ? source.slice(clean(currentTitle).length).trim() : source;
  const sourceSentences = body.split(/(?<=[。！？!?；;])\s*/).map(clean).filter(item => item.length >= 8);
  const core = extractCoreContent({ text: source, title: currentTitle, max: 160, maxPoints: 5 });
  const extracted = [...new Set([...(Array.isArray(keywords) ? keywords : []), ...extractKeywords(source, 8)])]
    .filter(item => item && source.toLowerCase().includes(String(item).toLowerCase()));
  const topic = core.topic || titleTopic({ text, filename, keywords: extracted, profile });
  const summary = core.summary || summarizeArticle({ text: source, title: currentTitle });
  const seen = new Set();
  const candidates = [];
  const addCandidate = (sentence, type = 'TOPIC', knownIndex = null) => {
    const evidence = clean(sentence);
    if (!evidence || !sourceSentences.includes(evidence)) return;
    const title = conciseTitleFromEvidence(evidence);
    if ([...title].length < 4 || seen.has(title)) return;
    seen.add(title);
    const sentenceIndex = Number.isInteger(knownIndex) ? knownIndex : sourceSentences.indexOf(evidence);
    const label = type === 'CONCLUSION' ? '正文核心结论' : type === 'METHOD' ? '正文可执行要点' : '正文核心观点';
    candidates.push({
      pattern: type.toLowerCase(),
      title,
      rationale: `结论先行 · 简短明了 · ${label}`,
      evidence: { source: 'article-body', sentence: evidence, sentenceIndex, type }
    });
  };
  const primary = core.conclusion || core.thesis;
  const primaryEvidence = core.keySentences.find(item => item.sentence === primary);
  if (primary) addCandidate(primary, primaryEvidence?.type || (core.conclusion ? 'CONCLUSION' : 'TOPIC'), primaryEvidence?.index);
  const supporting = [
    ...core.keySentences.filter(item => item.type === 'CONCLUSION'),
    ...core.keySentences.filter(item => item.type === 'METHOD'),
    ...core.keySentences.filter(item => item.type === 'TOPIC')
  ];
  for (const item of supporting) addCandidate(item.sentence, item.type, item.index);
  candidates.splice(Math.max(1, Math.min(8, Number(limit) || 5)));
  const selected = candidates[0]?.title || '';
  return {
    mode: 'viral',
    strategy: 'conclusion-first-hook',
    selected,
    topic,
    summary,
    keywords: extracted.slice(0, 8),
    candidates,
    generatedAt: new Date().toISOString(),
    note: candidates.length
      ? `从文章核心结论提炼完整短句，最多 ${TITLE_SUGGESTION_PREFERRED_CHARS} 字；每条均附正文依据，不拼接碎片、不预测阅读量。若无法在字数内保留完整语义则不生成，采纳前请核对全文。`
      : '正文缺少足够的核心句，暂不生成标题候选；请补充正文后再试。'
  };
}

const VISUAL_TOPIC_RULES = Object.freeze([
  { label: '自然山野', terms: ['山野', '自然', '森林', '树林', '树木', '风景', '溪流', '湖泊', '海边', '露营', '花草', '茶园', 'mountain', 'forest', 'nature', 'landscape'] },
  { label: '茶与饮品', terms: ['茶叶', '茶汤', '茶园', '冲泡', '品茶', '咖啡', '饮品', '春茶', 'tea', 'coffee', 'drink'] },
  { label: '心理成长', terms: ['心理', '成长', '情绪', '期待', '暗示', '沟通', '关系', '亲子', '自卑', 'mental', 'growth'] },
  { label: '人物生活', terms: ['人物', '人像', '肖像', '孩子', '老师', '女性', '男性', '家庭', 'portrait', 'person', 'people'] },
  { label: '服饰穿搭', terms: ['裙子', '衣服', '发型', '穿搭', '服装', '时尚', '鞋子', 'dress', 'fashion', 'outfit'] },
  { label: '美食餐饮', terms: ['美食', '餐饮', '食物', '料理', '菜品', '甜点', 'food', 'dish', 'restaurant'] },
  { label: '数据图表', terms: ['图表', '数据', '柱状', '折线', '饼图', '报表', 'dashboard', 'chart', 'graph'] },
  { label: '建筑空间', terms: ['建筑', '房间', '室内', '空间', '房屋', '街道', 'architecture', 'interior', 'building'] },
  { label: '文字截图', terms: ['截图', '文字', '海报', '书页', '二维码', 'screenshot', 'poster', 'text'] },
  { label: '产品物件', terms: ['产品', '包装', '设备', '手机', '电脑', '器具', 'product', 'device'] }
]);

function assetText(asset = {}) {
  return clean(`${asset.name || ''} ${asset.alt || ''} ${asset.caption || ''} ${asset.description || ''}`).toLowerCase();
}

function listValues(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value || '').split(/[,，、;；\n|]+/).map(clean).filter(Boolean);
}

/**
 * Produces a local-first image-content profile. Real OCR/vision adapters can
 * write caption, ocrText, labels, tags and confidence into asset.vision; the
 * fallback still works with filenames, alt text and descriptions only.
 */
export function recognizeAssetContent(asset = {}) {
  const vision = asset.vision && typeof asset.vision === 'object' ? asset.vision : {};
  const caption = clean(vision.caption || asset.caption || asset.description || '');
  const ocrText = clean(vision.ocrText || asset.ocrText || '');
  const labels = listValues(vision.labels || asset.labels);
  const tags = listValues(vision.tags || asset.tags);
  const evidence = clean([asset.name, asset.alt, caption, ocrText, ...labels, ...tags].filter(Boolean).join(' '));
  const lowerEvidence = evidence.toLowerCase();
  const topicLabels = VISUAL_TOPIC_RULES
    .filter(rule => rule.terms.some(term => lowerEvidence.includes(term.toLowerCase())))
    .map(rule => rule.label);
  const keywords = [...new Set([
    ...extractKeywords(evidence, 10),
    ...labels,
    ...tags
  ])].slice(0, 12);
  const width = Number(vision.width || asset.width || 0);
  const height = Number(vision.height || asset.height || 0);
  const aspectRatio = width > 0 && height > 0 ? Number((width / height).toFixed(3)) : null;
  const orientation = aspectRatio === null ? 'unknown' : aspectRatio > 1.15 ? 'landscape' : aspectRatio < 0.87 ? 'portrait' : 'square';
  const providedConfidence = Number(vision.confidence ?? asset.visionConfidence);
  const confidence = Number.isFinite(providedConfidence)
    ? Math.max(0, Math.min(1, providedConfidence))
    : topicLabels.length || labels.length || tags.length ? 0.72 : evidence ? 0.34 : 0;
  const source = vision.provider || (caption || ocrText || labels.length || tags.length ? 'asset-vision-metadata' : 'filename-alt-fallback');
  return {
    version: 1,
    source,
    caption,
    ocrText,
    labels: [...new Set([...topicLabels, ...labels])].slice(0, 8),
    tags: [...new Set(tags)].slice(0, 12),
    keywords,
    confidence,
    orientation,
    aspectRatio,
    evidence: truncate(evidence, 120)
  };
}

function blockHasImage(block = {}) { return block.type === 'image' && block.assetId || block.type === 'gallery' && (block.assetIds || []).length; }

const IMAGE_BUDGET_DEFAULTS = Object.freeze({ maxBodyImages: 6, charsPerImage: 900, headingWeight: 0.72 });

function compactLength(value = '') { return [...String(value).replace(/\s+/g, '')].length; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

/**
 * Calculates a conservative body-image budget from article length and structure.
 * It is intentionally deterministic so users can review and undo the result.
 */
export function deriveImageBudget(doc = {}, { includeCover = true, maxBodyImages = IMAGE_BUDGET_DEFAULTS.maxBodyImages } = {}) {
  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
  const source = plainArticleText(articleSource(doc));
  const contentChars = compactLength(source);
  const headingCount = blocks.filter(block => block.type === 'heading' && textOfBlock(block).trim()).length;
  const longParagraphCount = blocks.filter(block => ['paragraph', 'quote'].includes(block.type) && compactLength(textOfBlock(block)) >= 120).length;
  const quoteCount = blocks.filter(block => block.type === 'quote' && textOfBlock(block).trim()).length;
  const sectionSignal = Math.max(headingCount, Math.ceil(longParagraphCount / 2), quoteCount ? 1 : 0);
  const lengthImages = contentChars ? Math.ceil(contentChars / IMAGE_BUDGET_DEFAULTS.charsPerImage) : 0;
  const structureImages = sectionSignal ? Math.ceil(sectionSignal * IMAGE_BUDGET_DEFAULTS.headingWeight) : 0;
  const safeMax = clamp(Number(maxBodyImages) || IMAGE_BUDGET_DEFAULTS.maxBodyImages, 1, 12);
  const bodyImages = contentChars ? clamp(Math.max(1, lengthImages, structureImages), 1, safeMax) : 0;
  const imageBlocks = blocks.filter(block => block.type === 'image' && block.assetId);
  const currentCover = imageBlocks.find(block => block.visualRole === 'cover');
  const currentBodyImages = imageBlocks.filter(block => block !== currentCover).length;
  return {
    version: 1,
    mode: 'local-deterministic',
    contentChars,
    headingCount,
    longParagraphCount,
    bodyImages,
    currentBodyImages,
    coverImages: includeCover ? 1 : 0,
    totalImages: bodyImages + (includeCover ? 1 : 0),
    maxBodyImages: safeMax,
    rule: `按篇幅（约每 ${IMAGE_BUDGET_DEFAULTS.charsPerImage} 字一张）与章节密度取较大值，正文上限 ${safeMax} 张`
  };
}

function distributeAnchors(items, max) {
  if (items.length <= max) return items;
  if (max <= 0) return [];
  if (max <= 1) return items.slice(0, 1);
  return Array.from({ length: max }, (_, index) => items[Math.round(index * (items.length - 1) / (max - 1))]);
}

function anchorCandidates(doc = {}, { max = 4 } = {}) {
  const blocks = doc.blocks || [];
  const headings = blocks.map((block, index) => ({ block, index })).filter(item => item.block.type === 'heading');
  if (headings.length) {
    const sections = headings.map(({ block: heading, index }, sectionIndex) => {
      const nextHeading = headings[sectionIndex + 1]?.index ?? blocks.length;
      const body = blocks.slice(index + 1, nextHeading).filter(block => ['paragraph', 'quote', 'list'].includes(block.type) && clean(textOfBlock(block)).length > 0);
      if (!body.length) return null;
      const anchor = body.at(-1);
      const sectionText = [heading.text, ...body.map(textOfBlock)].filter(Boolean).join(' ');
      return { ...anchor, text: sectionText };
    }).filter(Boolean);
    return distributeAnchors(sections, max);
  }
  const paragraphs = blocks.filter(block => block.type === 'paragraph' && textOfBlock(block).length >= 28);
  return distributeAnchors(paragraphs.length ? paragraphs : blocks.filter(block => ['paragraph', 'quote', 'list'].includes(block.type)), max);
}

function scoreAsset(asset, anchorText, keywords) {
  const recognition = recognizeAssetContent(asset);
  const anchorRecognition = recognizeAssetContent({ alt: anchorText });
  const targetKeywords = [...new Set([
    ...extractKeywords(anchorText, 8),
    ...(Array.isArray(keywords) ? keywords : [])
  ])].map(keyword => keyword.toLowerCase());
  const label = `${assetText(asset)} ${recognition.evidence} ${recognition.keywords.join(' ')}`.toLowerCase();
  const matchedKeywords = new Set();
  const matchedLabels = recognition.labels.filter(labelName => anchorRecognition.labels.includes(labelName));
  let score = 0;
  for (const keyword of targetKeywords) {
    if (label.includes(keyword) || recognition.keywords.some(item => item.toLowerCase().includes(keyword) || keyword.includes(item.toLowerCase()))) {
      score += 3;
      matchedKeywords.add(keyword);
    }
  }
  score += matchedLabels.length * 6;
  if (/cover|封面|头图/.test(label)) score -= 4;
  if (label && score === 0) score = 0.1;
  return {
    score,
    matchedKeywords: [...matchedKeywords],
    matchedLabels,
    recognition
  };
}

/**
 * Plans cover and section placements. It never changes the document and can
 * therefore be shown to a human before applying it.
 */
export function planVisualLayout(doc = {}, { maxGenerated = 3, includeCover = true, fillUnmatched = false, autoImageCount = false, maxBodyImages = IMAGE_BUDGET_DEFAULTS.maxBodyImages } = {}) {
  const blocks = doc.blocks || [];
  const assets = doc.assets || [];
  const keywordPlan = generateArticleKeywords({ title: doc.title || '', text: articleSource(doc), max: 8 });
  const keywords = keywordPlan.keywords;
  const imageBudget = deriveImageBudget(doc, { includeCover, maxBodyImages });
  const assetAnalyses = assets.map(asset => ({ id: asset.id, name: asset.name, ...recognizeAssetContent(asset) }));
  const referenced = new Set(blocks.flatMap(block => [block.assetId, ...(block.assetIds || [])]).filter(Boolean));
  const imageBlocks = blocks.filter(block => block.type === 'image' && block.assetId);
  const isRaster = asset => /^image\/(?:png|jpe?g)$/i.test(asset?.type || '');
  const currentCoverBlock = imageBlocks.find(block => block.visualRole === 'cover');
  const currentCoverAsset = currentCoverBlock ? assets.find(asset => asset.id === currentCoverBlock.assetId) : null;
  const namedRasterCover = assets.find(asset => isRaster(asset) && /cover|封面|头图/i.test(assetText(asset)));
  const namedCover = assets.find(asset => asset.visualRole === 'cover') || assets.find(asset => /cover|封面|头图/i.test(assetText(asset)));
  const firstImageAsset = imageBlocks[0] ? assets.find(asset => asset.id === imageBlocks[0].assetId) : null;
  const available = assets.filter(asset => !referenced.has(asset.id));
  const semanticCover = available
    .map(asset => ({ asset, ...scoreAsset(asset, `${doc.title || ''} ${keywords.join(' ')}`, keywords) }))
    .sort((a, b) => b.score - a.score)[0];
  // Keep a human/current raster cover stable; when the current cover is only a
  // generated SVG, prefer an uploaded PNG/JPEG cover already in the library.
  const preferredCover = currentCoverAsset && (isRaster(currentCoverAsset) || !namedRasterCover)
    ? currentCoverAsset
    : (namedRasterCover || currentCoverAsset || namedCover || firstImageAsset || (semanticCover?.score >= 1 ? semanticCover.asset : null));
  const coverAsset = includeCover ? preferredCover : null;
  const coverBlock = coverAsset && imageBlocks.find(block => block.assetId === coverAsset.id);
  const currentBodyImages = imageBlocks.filter(block => block !== currentCoverBlock).length;
  const targetBodyImages = autoImageCount ? imageBudget.bodyImages : null;
  const remainingBodySlots = autoImageCount ? Math.max(0, targetBodyImages - currentBodyImages) : null;
  const usedForSections = new Set([coverAsset?.id].filter(Boolean));
  const sectionPlacements = [];
  const suggestions = [];
  let generatedCount = 0;
  let plannedBodyAdds = 0;

  for (const anchor of anchorCandidates(doc, { max: autoImageCount ? targetBodyImages : (fillUnmatched ? 12 : 4) })) {
    if (autoImageCount && plannedBodyAdds >= remainingBodySlots) break;
    const index = blocks.findIndex(block => block.id === anchor.id);
    const following = blocks[index + 1];
    const alreadyHasImage = following && blockHasImage(following);
    if (alreadyHasImage) continue;
    const candidates = assets.filter(asset => !referenced.has(asset.id) && !usedForSections.has(asset.id));
    const semanticMatch = candidates
      .map(asset => ({ asset, ...scoreAsset(asset, textOfBlock(anchor), keywords) }))
      .sort((a, b) => b.score - a.score)
      .find(item => item.score >= 1);
    // Never place an unrelated image merely to fill a slot. In asset-fill mode
    // the planner may inspect more anchors, but insertion still requires a
    // semantic signal from the local filename/alt/caption/OCR/labels.
    const chosen = semanticMatch?.asset || null;
    if (chosen) {
      usedForSections.add(chosen.id);
      const chosenRecognition = semanticMatch?.recognition || recognizeAssetContent(chosen);
      sectionPlacements.push({
        anchorId: anchor.id,
        assetId: chosen.id,
        role: 'section',
        reason: semanticMatch ? '图片内容识别+章节语义匹配' : '素材库图片自动填充',
        matchMethod: semanticMatch ? 'content-semantic-match' : 'content-recognition-fallback',
        confidence: semanticMatch ? Math.min(0.99, Math.max(0.5, 0.45 + semanticMatch.score / 20)) : chosenRecognition.confidence,
        matchedKeywords: semanticMatch?.matchedKeywords || [],
        matchedLabels: semanticMatch?.matchedLabels || [],
        contentLabels: chosenRecognition.labels,
        recognitionSource: chosenRecognition.source
      });
      plannedBodyAdds += 1;
      continue;
    }
    const generatedLimit = autoImageCount ? remainingBodySlots : Math.max(0, maxGenerated);
    if (generatedCount < generatedLimit) {
      generatedCount += 1;
      sectionPlacements.push({ anchorId: anchor.id, assetId: null, role: 'section', reason: '本地创意图占位', brief: textOfBlock(anchor) });
      plannedBodyAdds += 1;
    } else {
      suggestions.push(`建议为“${truncate(textOfBlock(anchor), 22)}”补充一张场景图`);
    }
  }
  if (includeCover && !coverAsset) suggestions.unshift('建议生成一张标题封面图，首图将用于公众号草稿封面');
  return {
    keywords,
    hashtags: keywordPlan.hashtags,
    assetAnalyses,
    recognition: { version: 1, mode: 'local-metadata-with-vision-adapter-seam' },
    imageBudget: {
      ...imageBudget,
      auto: autoImageCount,
      targetBodyImages,
      plannedBodyImages: currentBodyImages + plannedBodyAdds,
      plannedNewBodyImages: plannedBodyAdds
    },
    coverAssetId: coverAsset?.id || null,
    coverBlockId: coverBlock?.id || null,
    sectionPlacements,
    suggestions,
    generatedSlots: (coverAsset ? 0 : 1) + sectionPlacements.filter(item => !item.assetId).length,
    maxGenerated,
    fillUnmatched
  };
}

function paletteFor(theme = 'minimal') { return PALETTES[theme] || PALETTES.minimal; }
function svgDataUrl(svg) { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }

function inferVisualTopic(title = '', keywords = []) {
  const text = `${title} ${keywords.join(' ')}`.toLowerCase();
  if (/\b(?:ai|llm|agent|codex|claude|chatgpt|robot|software|code)\b|人工智能|大模型|智能体|自动化|编程|软件|算法|数据|科技/u.test(text)) return 'technology';
  if (/自然|山野|森林|茶|植物|生态|旅行|户外|风景|花园/u.test(text)) return 'nature';
  if (/商业|经营|创业|产品|市场|品牌|销售|客户|收入|成本|生意/u.test(text)) return 'business';
  if (/教育|教学|课程|学习|课堂|学校|老师|知识|阅读/u.test(text)) return 'learning';
  if (/成长|改变|习惯|能力|人生|心理|关系|行动|实践|工作/u.test(text)) return 'growth';
  return 'general';
}

function renderThemeMotif(theme, palette) {
  const stroke = `stroke="${palette.accent}"`;
  const inkStroke = `stroke="${palette.ink}"`;
  const motifs = {
    minimal: `<g fill="none" ${stroke} opacity=".34"><circle cx="756" cy="142" r="92" stroke-width="2"/><circle cx="756" cy="142" r="62" stroke-width="2"/><path d="M630 258h208M670 278h168" stroke-width="2"/></g>`,
    editorial: `<g fill="none" ${inkStroke} opacity=".28"><rect x="610" y="52" width="232" height="278" rx="4" stroke-width="2"/><path d="M634 80h142M634 91h92M634 300h174" stroke-width="5"/><path d="M798 78v202" stroke-width="2"/></g>`,
    fresh: `<g fill="${palette.soft}" opacity=".42"><path d="M650 292c-40-74-6-165 91-208 2 89-20 166-91 208Z"/><path d="M711 306c-4-73 43-137 127-162-10 82-53 142-127 162Z"/><path d="M681 304c23-61 54-112 94-158" fill="none" ${stroke} stroke-width="4"/></g>`,
    ink: `<g fill="none" ${stroke} opacity=".38"><path d="M616 260c36-122 113-168 221-167-67 34-100 84-112 154-10 59-45 83-109 70 44-21 62-50 65-92" stroke-width="9" stroke-linecap="round"/><circle cx="814" cy="284" r="16" fill="${palette.accent}" stroke="none"/><circle cx="644" cy="88" r="8" fill="${palette.accent}" stroke="none"/></g>`,
    sunset: `<g><circle cx="754" cy="136" r="70" fill="${palette.accent}" opacity=".22"/><path d="M570 253 680 177l69 55 92-102 107 123" fill="none" ${stroke} stroke-width="5" opacity=".52"/><path d="M577 286h300M621 306h240" ${stroke} stroke-width="3" opacity=".28"/></g>`,
    official: `<g fill="none" ${stroke} opacity=".38"><rect x="620" y="66" width="224" height="222" rx="18" stroke-width="3"/><path d="M650 112h164M650 144h112M650 176h145" stroke-width="8" stroke-linecap="round"/><circle cx="793" cy="232" r="28" fill="${palette.accent}" opacity=".25" stroke-width="2"/></g>`
  };
  return motifs[theme] || motifs.minimal;
}

function renderTopicMotif(topic, palette) {
  const accent = palette.accent;
  const ink = palette.ink;
  const motifs = {
    technology: `<g fill="none" stroke="${accent}" stroke-width="4" opacity=".48"><path d="M650 166 730 112l82 48-68 93-94-25 0-62Z"/><circle cx="650" cy="166" r="11" fill="${accent}"/><circle cx="730" cy="112" r="11" fill="${accent}"/><circle cx="812" cy="160" r="11" fill="${accent}"/><circle cx="744" cy="253" r="11" fill="${accent}"/><circle cx="650" cy="228" r="11" fill="${accent}"/></g>`,
    nature: `<g fill="none" stroke="${accent}" stroke-width="5" opacity=".46"><path d="M634 284c47-76 89-132 171-190M690 221c-35-44-51-76-51-112 43 19 70 49 82 92M747 166c25-45 57-66 101-70-8 46-34 78-81 94"/><path d="M625 298h236" stroke-width="3"/></g>`,
    business: `<g fill="${accent}" opacity=".3"><rect x="630" y="218" width="38" height="72" rx="6"/><rect x="691" y="178" width="38" height="112" rx="6"/><rect x="752" y="132" width="38" height="158" rx="6"/><rect x="813" y="92" width="38" height="198" rx="6"/></g><path d="m634 196 77-47 60-16 77-57" fill="none" stroke="${ink}" stroke-width="5" opacity=".55"/>`,
    learning: `<g fill="none" stroke="${accent}" stroke-width="5" opacity=".5"><path d="M626 132c50-17 94-8 126 25v144c-37-30-80-38-126-23V132ZM752 157c35-31 78-40 128-25v146c-46-15-89-7-128 23V157Z"/><path d="M650 174h48M650 198h56M777 174h72M777 198h58" stroke-width="4"/></g>`,
    growth: `<g fill="${accent}" opacity=".34"><path d="M622 286h50v-44h48v-48h48v-48h48v-48h48v188H622Z"/></g><path d="M650 244c34-42 63-63 101-77 30-11 49-32 62-64m-80 98c-4-40 7-66 34-86m8 54c29-4 48-18 61-44" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" opacity=".52"/>`,
    general: `<g fill="none" stroke="${accent}" stroke-width="4" opacity=".4"><circle cx="746" cy="174" r="105"/><path d="M641 174h210M746 69v210M672 100l148 148m0-148L672 248"/><circle cx="746" cy="174" r="43" fill="${palette.soft}" opacity=".55"/></g>`
  };
  return motifs[topic] || motifs.general;
}

export function renderCreativeSvg({ title = '', subtitle = '', keywords = [], theme = 'minimal', colorPalette = 'default', role = 'section', index = 0 } = {}) {
  const palette = colorPalette === 'ral-inspired' ? PALETTES.ralInspired : paletteFor(theme);
  const visualTheme = PALETTES[theme] ? theme : 'minimal';
  const visualTopic = inferVisualTopic(title, keywords);
  const isCover = role === 'cover';
  const rawTitle = clean(title) || '一段值得分享的真实体验';
  const mainText = isCover ? truncate(rawTitle, WECHAT_LIMITS.titleImage.mainChars) : rawTitle;
  const suppliedSubtitle = clean(subtitle);
  const boilerplateSubtitle = /^(?:文章语义场景图|根据文章核心内容生成|自动排版草稿|未命名主题)$/;
  const subText = isCover
    ? truncate(suppliedSubtitle || keywords.slice(0, 2).join(' · '), WECHAT_LIMITS.titleImage.subChars)
    : (suppliedSubtitle && !boilerplateSubtitle.test(suppliedSubtitle) ? suppliedSubtitle : keywords.slice(0, 2).join(' · '));
  const mainFont = isCover ? 48 : 50;
  const subFont = isCover ? 30 : 30;
  const maxTextWidth = 792;
  const wrapLines = (value, fontSize) => {
    const lines = [];
    let line = '';
    let width = 0;
    for (const character of [...String(value || '')]) {
      if (character === '\n') {
        if (line) lines.push(line);
        line = '';
        width = 0;
        continue;
      }
      const charWidth = /[\u2e80-\u9fff\uff00-\uffef]/.test(character) ? 1 : /\s/.test(character) ? 0.34 : /[.,:;!?，。！？；：、]/.test(character) ? 0.5 : 0.62;
      if (line && width + charWidth * fontSize > maxTextWidth) {
        lines.push(line);
        line = '';
        width = 0;
      }
      line += character;
      width += charWidth * fontSize;
    }
    if (line) lines.push(line);
    return lines;
  };
  const mainLines = wrapLines(mainText, mainFont);
  const subLines = wrapLines(subText, subFont);
  const lineSpans = (lines, lineHeight) => lines.map((line, lineIndex) => `<tspan x="54"${lineIndex ? ` dy="${lineHeight}"` : ''}>${escapeXml(line)}</tspan>`).join('');
  const mainLineHeight = Math.round(mainFont * 1.22);
  const subLineHeight = Math.round(subFont * 1.3);
  const mainY = isCover ? 168 : 190;
  const subY = mainY + Math.max(1, mainLines.length) * mainLineHeight + (isCover ? 24 : 30);
  const subHeight = subLines.length * subLineHeight;
  const height = isCover ? 383 : Math.max(506, subY + subHeight + 82);
  const accentY = Math.min(height - 28, subY + subHeight + 26);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}" data-theme="${visualTheme}" data-topic="${visualTopic}">
  <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${palette.bg}"/><stop offset="1" stop-color="${palette.soft}"/></linearGradient></defs>
  <rect width="900" height="100%" fill="url(#g)"/><path d="M0 ${Math.max(360, height - 110)} C180 ${Math.max(300, height - 190)} 276 ${height - 40} 448 ${Math.max(350, height - 130)} S720 ${Math.max(300, height - 200)} 900 ${Math.max(360, height - 110)} V${height} H0Z" fill="${palette.accent}" opacity=".08"/><g data-art-style="${visualTheme}">${renderThemeMotif(visualTheme, palette)}</g><g data-art-topic="${visualTopic}">${renderTopicMotif(visualTopic, palette)}</g>
  <text x="54" y="${mainY}" font-size="${mainFont}" font-weight="700" fill="${palette.ink}">${lineSpans(mainLines, mainLineHeight)}</text>${subLines.length ? `<text x="54" y="${subY}" font-size="${subFont}" fill="${palette.ink}" opacity=".82">${lineSpans(subLines, subLineHeight)}</text>` : ''}
  <path d="M54 ${accentY} H250" stroke="${palette.accent}" stroke-width="7" stroke-linecap="round"/>
  </svg>`;
}

export function createCreativeAsset({ title, subtitle, keywords = [], theme = 'minimal', colorPalette = 'default', role = 'section', index = 0, anchorId = null, id = null } = {}) {
  const safeTitle = clean(title) || '未命名主题';
  const svg = renderCreativeSvg({ title: safeTitle, subtitle, keywords, theme, colorPalette, role, index });
  const dataUrl = svgDataUrl(svg);
  const height = Number(svg.match(/\bheight="(\d+)"/)?.[1]) || (role === 'cover' ? 383 : 506);
  return {
    id: id || randomId(),
    name: role === 'cover' ? 'draftloom-title-cover.svg' : role === 'theme' ? `draftloom-theme-${index + 1}.svg` : `draftloom-section-${index + 1}.svg`,
    type: 'image/svg+xml',
    size: dataUrl.length,
    width: 900,
    height,
    dataUrl,
    alt: role === 'cover' ? `${safeTitle} 标题封面` : role === 'theme' ? `${safeTitle} 主题图` : `${safeTitle} 场景图`,
    ...(role === 'cover' ? { coverMain: truncate(safeTitle, WECHAT_LIMITS.titleImage.mainChars), coverSub: truncate(subtitle || keywords.slice(0, 3).join(' · '), WECHAT_LIMITS.titleImage.subChars) } : {}),
    source: 'draftloom:creative-local',
    generated: true,
    theme,
    colorPalette,
    visualRole: role,
    visualAnchor: anchorId,
    prompt: `根据文章${role === 'cover' ? '主题' : role === 'theme' ? '核心内容' : '章节主题'}“${safeTitle}”生成${role === 'cover' ? '标题封面' : role === 'theme' ? '主题图' : '章节场景'}；关键词：${keywords.join('、')}`,
    createdAt: new Date().toISOString()
  };
}

function insertAfterAnchor(blocks, anchorId, block) {
  const index = blocks.findIndex(item => item.id === anchorId);
  if (index < 0 || blocks.some(item => item.id === block.id)) return false;
  blocks.splice(index + 1, 0, block);
  return true;
}

/** Applies the plan and returns a new document, suitable for a reducer intent. */
export function autoComposeDocument(input = {}, { generate = true, maxGenerated = 3, includeCover = true, titleMode = 'safe', forceTitle = false, titleProfile = {}, fillUnmatched = false, useCoreForCover = false, forceCoreSummary = false, autoImageCount = false, maxBodyImages = IMAGE_BUDGET_DEFAULTS.maxBodyImages, coreThemeCount = 0, colorPalette = 'default' } = {}) {
  const next = clone(input);
  const source = articleSource(next);
  const currentBody = (next.blocks || []).filter(block => !['image', 'heading'].includes(block.type)).map(textOfBlock).filter(Boolean).join('\n') || source;
  const coreContent = extractCoreContent({ text: currentBody, title: next.title, max: 96, maxPoints: 3 });
  const titlePlan = titleMode === 'viral'
    ? generateViralTitlePlan({ text: currentBody, filename: next.meta?.importedFrom || '', currentTitle: next.title, keywords: coreContent.keywords, profile: titleProfile })
    : null;
  const canAutoSetTitle = forceTitle === true || next.meta?.titleLocked !== true;
  const titleInfo = titlePlan?.selected && canAutoSetTitle
    ? { title: titlePlan.selected, confidence: 0.86, source: 'viral', mode: 'viral' }
    : deriveArticleTitle({ text: source, filename: next.meta?.importedFrom || '', currentTitle: next.title });
  const preserveHumanSummary = next.meta?.subtitleLocked === true || next.meta?.subtitleSource === 'human';
  const subtitle = forceCoreSummary && !preserveHumanSummary ? coreContent.summary : preserveHumanSummary ? next.subtitle : deriveArticleSubtitle({ text: source, currentSubtitle: next.subtitle });
  if (canAutoSetTitle || !next.title) next.title = titleInfo.title;
  if (!preserveHumanSummary || !forceCoreSummary) next.subtitle = subtitle;
  next.assets = Array.isArray(next.assets) ? next.assets : [];
  next.blocks = Array.isArray(next.blocks) ? next.blocks : [];

  const plan = planVisualLayout(next, { maxGenerated, includeCover, fillUnmatched, autoImageCount, maxBodyImages });
  const plannedAnalyses = new Map(plan.assetAnalyses.map(item => [item.id, item]));
  for (const asset of next.assets) {
    const analysis = plannedAnalyses.get(asset.id);
    if (analysis) asset.recognition = analysis;
  }
  const generatedAssetIds = [];
  const findGenerated = (role, anchorId = null, purpose = null, themeIndex = null) => next.assets.find(asset => asset.generated && asset.source === 'draftloom:creative-local' && asset.visualRole === role && (asset.visualAnchor || null) === (anchorId || null) && (!purpose || asset.visualPurpose === purpose) && (themeIndex === null || asset.themeIndex === themeIndex));
  const addOrUpdateGenerated = ({ role, anchorId = null, index = 0, brief = '', subtitle = '', purpose = null, coreSummary = '', themeIndex = null }) => {
    const keywords = extractKeywords(`${next.title}\n${brief}\n${source}`, 6);
    const existing = findGenerated(role, anchorId, purpose, themeIndex);
    const asset = createCreativeAsset({ id: existing?.id, title: role === 'cover' ? next.title : (brief || next.title), subtitle: role === 'cover' ? (subtitle || next.subtitle) : (subtitle || (role === 'theme' ? '根据文章核心内容生成' : '文章语义场景图')), keywords, theme: next.theme, colorPalette, role, index, anchorId });
    if (purpose) Object.assign(asset, { visualPurpose: purpose, coreSummary: clean(coreSummary), themeIndex });
    const position = next.assets.findIndex(item => item.id === asset.id);
    if (position >= 0) next.assets[position] = asset;
    else next.assets.push(asset);
    generatedAssetIds.push(asset.id);
    return asset;
  };

  let coverAssetId = plan.coverAssetId;
  if (includeCover && !coverAssetId && generate) coverAssetId = addOrUpdateGenerated({ role: 'cover', brief: next.title, subtitle: useCoreForCover ? coreContent.summary : next.subtitle }).id;
  if (includeCover && coverAssetId) {
    const existingCoverIndex = next.blocks.findIndex(block => block.type === 'image' && block.assetId === coverAssetId);
    if (existingCoverIndex >= 0) {
      const [coverBlock] = next.blocks.splice(existingCoverIndex, 1);
      coverBlock.visualRole = coverBlock.visualRole || 'cover';
      next.blocks.unshift(coverBlock);
    } else {
      next.blocks.unshift({ id: randomId(), type: 'image', assetId: coverAssetId, text: next.assets.find(asset => asset.id === coverAssetId)?.alt || `${next.title} 封面`, visualRole: 'cover', generatedBy: next.assets.find(asset => asset.id === coverAssetId)?.generated ? 'autoComposeVisuals' : undefined });
    }
  }

  const coreThemeImageIds = [];
  const requestedCoreThemeCount = Math.min(4, Math.max(0, Number(coreThemeCount) || 0));
  if (requestedCoreThemeCount && generate) {
    const themeAnchors = anchorCandidates(next, { max: requestedCoreThemeCount });
    const themePoints = coreContent.points?.length ? coreContent.points : [coreContent.summary];
    const themeCount = Math.min(requestedCoreThemeCount, themeAnchors.length);
    for (let index = 0; index < themeCount; index += 1) {
      const anchor = themeAnchors[index] || themeAnchors[themeAnchors.length - 1];
      const brief = themePoints[index] || textOfBlock(anchor || {}) || coreContent.summary || next.title;
      const asset = addOrUpdateGenerated({
        role: 'theme',
        purpose: 'core-theme',
        anchorId: anchor?.id || null,
        index,
        brief,
        subtitle: '根据文章核心内容生成',
        coreSummary: coreContent.summary,
        themeIndex: index
      });
      coreThemeImageIds.push(asset.id);
      if (!anchor?.id) continue;
      const alreadyPlaced = next.blocks.some(block => block.type === 'image' && block.assetId === asset.id);
      if (alreadyPlaced) continue;
      insertAfterAnchor(next.blocks, anchor.id, {
        id: randomId(),
        type: 'image',
        assetId: asset.id,
        text: asset.alt || `${brief} 主题图`,
        visualRole: 'theme',
        visualPurpose: 'core-theme',
        visualAnchor: anchor.id,
        visualMatch: {
          confidence: 0.82,
          matchedKeywords: extractKeywords(brief, 4),
          matchedLabels: [],
          contentLabels: ['核心主题'],
          recognitionSource: 'core-content',
          matchMethod: 'core-content-anchor',
          reason: '文章核心内容主题图'
        },
        generatedBy: 'coreThemeImages'
      });
    }
  }

  let generatedIndex = 0;
  let appliedBodyAdds = 0;
  const appliedSectionPlacements = [];
  for (const placement of plan.sectionPlacements) {
    if (autoImageCount && plan.imageBudget.currentBodyImages + appliedBodyAdds >= plan.imageBudget.targetBodyImages) break;
    const anchorIndex = next.blocks.findIndex(block => block.id === placement.anchorId);
    if (anchorIndex >= 0 && next.blocks[anchorIndex + 1]?.type === 'image') continue;
    let assetId = placement.assetId;
    if (!assetId && generate) assetId = addOrUpdateGenerated({ role: 'section', anchorId: placement.anchorId, index: generatedIndex++, brief: placement.brief }).id;
    if (!assetId) continue;
    const alreadyPlaced = next.blocks.some(block => block.type === 'image' && block.assetId === assetId && (block.visualAnchor === placement.anchorId || !block.visualAnchor));
    if (alreadyPlaced) continue;
    const asset = next.assets.find(item => item.id === assetId);
    const inserted = insertAfterAnchor(next.blocks, placement.anchorId, {
      id: randomId(),
      type: 'image',
      assetId,
      text: asset?.alt || placement.brief || '章节配图',
      visualRole: 'section',
      visualAnchor: placement.anchorId,
      visualMatch: {
        confidence: placement.confidence || null,
        matchedKeywords: placement.matchedKeywords || [],
        matchedLabels: placement.matchedLabels || [],
        contentLabels: placement.contentLabels || [],
        recognitionSource: placement.recognitionSource || null,
        matchMethod: placement.matchMethod || null,
        reason: placement.reason
      },
      generatedBy: asset?.generated ? 'autoComposeVisuals' : undefined
    });
    if (inserted) {
      appliedBodyAdds += 1;
      appliedSectionPlacements.push({ ...placement, placed: true });
    }
  }

  const finalAssetAnalyses = next.assets.map(asset => ({ id: asset.id, name: asset.name, ...recognizeAssetContent(asset) }));
  for (const analysis of finalAssetAnalyses) {
    const asset = next.assets.find(item => item.id === analysis.id);
    if (asset) asset.recognition = analysis;
  }
  const finalImageBlocks = next.blocks.filter(block => block.type === 'image' && block.assetId);
  const finalCoverBlock = finalImageBlocks.find(block => block.visualRole === 'cover');
  const finalBodyImages = finalImageBlocks.filter(block => block !== finalCoverBlock).length;

  next.meta = {
    ...(next.meta || {}),
    ...(forceCoreSummary && !preserveHumanSummary ? { subtitleLocked: false, subtitleSource: 'core' } : {}),
    layoutMode: 'smart',
    visualPlan: {
      version: 1,
      generatedAt: new Date().toISOString(),
      title: titleInfo,
      coreContent,
      imageBudget: {
        ...plan.imageBudget,
        appliedNewBodyImages: appliedBodyAdds,
        finalBodyImages,
        finalTotalImages: finalImageBlocks.length
      },
      keywords: plan.keywords,
      assetAnalyses: finalAssetAnalyses,
      recognition: plan.recognition,
      coverAssetId,
      generatedAssetIds: [...new Set(generatedAssetIds)],
      coreThemeImageIds,
      placements: generate ? appliedSectionPlacements : plan.sectionPlacements,
      hashtags: plan.hashtags || generateArticleKeywords({ title: next.title, text: source, existingKeywords: plan.keywords, max: 8 }).hashtags,
      suggestions: plan.suggestions.filter(item => !(coverAssetId && item.includes('标题封面图'))),
      provider: generate ? 'local-svg-fallback' : 'planning-only'
    },
    titlePlan: titlePlan ? {
      ...titlePlan,
      selected: canAutoSetTitle ? titlePlan.selected : next.title,
      applied: canAutoSetTitle,
      locked: next.meta?.titleLocked === true
    } : next.meta?.titlePlan
  };
  return next;
}
