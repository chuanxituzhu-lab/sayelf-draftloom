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
  '图片', '图像', '素材', '章节', '部分', '第一', '第二', '自动', '填充',
  'with', 'from', 'that', 'this', 'the', 'and', 'for', 'are', 'you', 'your'
]);

const PALETTES = Object.freeze({
  minimal: { bg: '#eef6f2', ink: '#153b2e', accent: '#1f9d72', soft: '#a9dfc7' },
  editorial: { bg: '#f7eee5', ink: '#4c3022', accent: '#a8683e', soft: '#e2baa0' },
  fresh: { bg: '#eaf8f8', ink: '#174650', accent: '#218a9b', soft: '#a9dfe2' }
});

function clone(value) { return structuredClone(value); }
function textOfBlock(block = {}) { return block.text || (block.items || []).join('，') || ''; }
function clean(value = '') { return String(value).replace(/\s+/g, ' ').trim(); }
function truncate(value, max = 32) {
  const chars = [...clean(value)];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
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
  const paragraph = String(text).replace(/^---[\s\S]*?---\s*/m, '').split(/\r?\n\s*\r?\n/)
    .map(value => clean(value).replace(/^#{1,6}\s+/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, ''))
    .find(value => value.length >= 12);
  return paragraph ? truncate(paragraph, 64) : DEFAULT_SUBTITLE;
}

function plainArticleText(value = '') {
  return String(value)
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns a short, deterministic summary that can be shown before a title is applied. */
export function summarizeArticle({ text = '', title = '', max = 88 } = {}) {
  const source = plainArticleText(text);
  const sentences = source.split(/(?<=[。！？!?；;])\s*/).map(clean).filter(item => item.length >= 8);
  const summary = sentences.slice(0, 2).join(' ');
  const fallback = clean(title) || source;
  return truncate(summary || fallback || '围绕文章主题提炼一个清晰、可读、值得继续阅读的观点。', max);
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

/**
 * Builds engaging but evidence-bound title candidates. “爆款” here means a
 * strong hook (question, contrast, story or practical takeaway), not fabricated
 * claims. Candidates are kept under the WeChat 32-character title limit.
 */
export function generateViralTitlePlan({ text = '', filename = '', currentTitle = '', keywords = [], profile = {}, limit = 5 } = {}) {
  const source = plainArticleText(text);
  const extracted = [...new Set([...(Array.isArray(keywords) ? keywords : []), ...extractKeywords(source, 8)])].filter(Boolean);
  const topic = titleTopic({ text, filename, keywords: extracted, profile });
  const secondary = extracted.find(item => item !== topic && item.length >= 2) || '真实经验';
  const summary = summarizeArticle({ text: source, title: currentTitle });
  const detail = truncate(summary.replace(/[。！？!?].*$/, ''), 15);
  const raw = [
    { pattern: 'question', title: `为什么${topic}，很多人都忽略了这一点？`, rationale: '问题钩子 + 留下阅读悬念' },
    { pattern: 'contrast', title: `别只看到${topic}的表面：关键其实是${secondary}`, rationale: '反差表达 + 核心关键词前置' },
    { pattern: 'insight', title: `原来，${topic}背后藏着一个被忽略的规律`, rationale: '反常识切口 + 观点承诺' },
    { pattern: 'story', title: `一个真实案例，讲透${topic}为什么有效`, rationale: '真实案例 + 明确收益' },
    { pattern: 'takeaway', title: `从“${detail || topic}”看懂${topic}`, rationale: '内容摘要 + 读者可获得的结论' }
  ];
  const seen = new Set();
  const candidates = raw.map(item => ({
    ...item,
    title: truncate(item.title.replace(/\s+/g, ' '), 32),
    score: item.pattern === 'question' ? 92 : item.pattern === 'contrast' ? 90 : item.pattern === 'insight' ? 88 : item.pattern === 'story' ? 86 : 84
  })).filter(item => {
    if (!item.title || seen.has(item.title)) return false;
    seen.add(item.title);
    return true;
  }).slice(0, Math.max(1, Math.min(8, Number(limit) || 5)));
  const selected = candidates[0]?.title || deriveArticleTitle({ text: source, filename, currentTitle }).title;
  return {
    mode: 'viral',
    selected,
    topic,
    summary,
    keywords: extracted.slice(0, 8),
    candidates,
    generatedAt: new Date().toISOString(),
    note: '候选标题只使用文章中已出现的主题词；发布前仍建议人工核对事实与语气。'
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
function anchorCandidates(doc = {}, { max = 4 } = {}) {
  const blocks = doc.blocks || [];
  const headings = blocks.filter(block => block.type === 'heading');
  if (headings.length) return headings.slice(0, max);
  const paragraphs = blocks.filter(block => block.type === 'paragraph' && textOfBlock(block).length >= 28);
  return (paragraphs.length ? paragraphs : blocks.filter(block => ['paragraph', 'quote', 'list'].includes(block.type))).slice(0, max);
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
export function planVisualLayout(doc = {}, { maxGenerated = 3, includeCover = true, fillUnmatched = false } = {}) {
  const blocks = doc.blocks || [];
  const assets = doc.assets || [];
  const keywords = extractKeywords(`${doc.title || ''}\n${articleSource(doc)}`, 8);
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
  const usedForSections = new Set([coverAsset?.id].filter(Boolean));
  const sectionPlacements = [];
  const suggestions = [];
  let generatedCount = 0;

  for (const anchor of anchorCandidates(doc, { max: fillUnmatched ? 12 : 4 })) {
    const index = blocks.findIndex(block => block.id === anchor.id);
    const following = blocks[index + 1];
    const alreadyHasImage = following && blockHasImage(following);
    if (alreadyHasImage) continue;
    const candidates = assets.filter(asset => !referenced.has(asset.id) && !usedForSections.has(asset.id));
    const semanticMatch = candidates
      .map(asset => ({ asset, ...scoreAsset(asset, textOfBlock(anchor), keywords) }))
      .sort((a, b) => b.score - a.score)
      .find(item => item.score >= 1);
    const chosen = semanticMatch?.asset || (fillUnmatched ? candidates[0] : null);
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
      continue;
    }
    if (generatedCount < Math.max(0, maxGenerated)) {
      generatedCount += 1;
      sectionPlacements.push({ anchorId: anchor.id, assetId: null, role: 'section', reason: '本地创意图占位', brief: textOfBlock(anchor) });
    } else {
      suggestions.push(`建议为“${truncate(textOfBlock(anchor), 22)}”补充一张场景图`);
    }
  }
  if (includeCover && !coverAsset) suggestions.unshift('建议生成一张标题封面图，首图将用于公众号草稿封面');
  return {
    keywords,
    assetAnalyses,
    recognition: { version: 1, mode: 'local-metadata-with-vision-adapter-seam' },
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

export function renderCreativeSvg({ title = '', subtitle = '', keywords = [], theme = 'minimal', role = 'section', index = 0 } = {}) {
  const palette = paletteFor(theme);
  const main = escapeXml(truncate(title || '一段值得分享的真实体验', role === 'cover' ? WECHAT_LIMITS.titleImage.mainChars : 22));
  const sub = escapeXml(truncate(subtitle || keywords.slice(0, 3).join(' · '), role === 'cover' ? WECHAT_LIMITS.titleImage.subChars : 30));
  const chips = keywords.slice(0, 3).map((keyword, chipIndex) => `<text x="${56 + chipIndex * 142}" y="326" font-size="16" fill="${palette.ink}" opacity=".72">${escapeXml(truncate(keyword, 8))}</text>`).join('');
  const badge = role === 'cover' ? 'DRAFTLOOM · TITLE VISUAL' : `SECTION ${String(index + 1).padStart(2, '0')}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${role === 'cover' ? 383 : 506}" viewBox="0 0 900 ${role === 'cover' ? 383 : 506}">
  <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${palette.bg}"/><stop offset="1" stop-color="${palette.soft}"/></linearGradient></defs>
  <rect width="900" height="100%" fill="url(#g)"/><circle cx="760" cy="108" r="148" fill="${palette.accent}" opacity=".16"/><circle cx="814" cy="168" r="88" fill="${palette.accent}" opacity=".12"/><path d="M0 402 C180 332 276 468 448 388 S720 330 900 422 V506 H0Z" fill="${palette.accent}" opacity=".12"/>
  <rect x="54" y="48" width="278" height="30" rx="15" fill="${palette.ink}" opacity=".1"/><text x="72" y="69" font-size="14" letter-spacing="2" fill="${palette.ink}" opacity=".7">${badge}</text>
  <text x="54" y="183" font-size="42" font-weight="700" fill="${palette.ink}">${main}</text><text x="54" y="230" font-size="20" fill="${palette.ink}" opacity=".76">${sub}</text>${chips}
  <path d="M54 ${role === 'cover' ? 284 : 382} H210" stroke="${palette.accent}" stroke-width="6" stroke-linecap="round"/><text x="54" y="${role === 'cover' ? 350 : 448}" font-size="14" fill="${palette.ink}" opacity=".58">由 Draftloom 根据文章语义生成 · 人工可替换</text>
  </svg>`;
}

export function createCreativeAsset({ title, subtitle, keywords = [], theme = 'minimal', role = 'section', index = 0, anchorId = null, id = null } = {}) {
  const safeTitle = clean(title) || '未命名主题';
  const svg = renderCreativeSvg({ title: safeTitle, subtitle, keywords, theme, role, index });
  const dataUrl = svgDataUrl(svg);
  return {
    id: id || randomId(),
    name: role === 'cover' ? 'draftloom-title-cover.svg' : `draftloom-section-${index + 1}.svg`,
    type: 'image/svg+xml',
    size: dataUrl.length,
    width: 900,
    height: role === 'cover' ? 383 : 506,
    dataUrl,
    alt: role === 'cover' ? `${safeTitle} 标题封面` : `${safeTitle} 场景图`,
    ...(role === 'cover' ? { coverMain: truncate(safeTitle, WECHAT_LIMITS.titleImage.mainChars), coverSub: truncate(subtitle || keywords.slice(0, 3).join(' · '), WECHAT_LIMITS.titleImage.subChars) } : {}),
    source: 'draftloom:creative-local',
    generated: true,
    theme,
    visualRole: role,
    visualAnchor: anchorId,
    prompt: `根据文章主题“${safeTitle}”生成${role === 'cover' ? '标题封面' : '章节场景'}；关键词：${keywords.join('、')}`,
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
export function autoComposeDocument(input = {}, { generate = true, maxGenerated = 3, includeCover = true, titleMode = 'safe', forceTitle = false, titleProfile = {}, fillUnmatched = false } = {}) {
  const next = clone(input);
  const source = articleSource(next);
  const titlePlan = titleMode === 'viral'
    ? generateViralTitlePlan({ text: source, filename: next.meta?.importedFrom || '', currentTitle: next.title, profile: titleProfile })
    : null;
  const canAutoSetTitle = forceTitle === true || next.meta?.titleLocked !== true;
  const titleInfo = titlePlan && canAutoSetTitle
    ? { title: titlePlan.selected, confidence: 0.86, source: 'viral', mode: 'viral' }
    : deriveArticleTitle({ text: source, filename: next.meta?.importedFrom || '', currentTitle: next.title });
  const subtitle = deriveArticleSubtitle({ text: source, currentSubtitle: next.subtitle });
  if (canAutoSetTitle || !next.title) next.title = titleInfo.title;
  next.subtitle = subtitle;
  next.assets = Array.isArray(next.assets) ? next.assets : [];
  next.blocks = Array.isArray(next.blocks) ? next.blocks : [];

  const plan = planVisualLayout(next, { maxGenerated, includeCover, fillUnmatched });
  const plannedAnalyses = new Map(plan.assetAnalyses.map(item => [item.id, item]));
  for (const asset of next.assets) {
    const analysis = plannedAnalyses.get(asset.id);
    if (analysis) asset.recognition = analysis;
  }
  const generatedAssetIds = [];
  const findGenerated = (role, anchorId = null) => next.assets.find(asset => asset.generated && asset.source === 'draftloom:creative-local' && asset.visualRole === role && (asset.visualAnchor || null) === (anchorId || null));
  const addOrUpdateGenerated = ({ role, anchorId = null, index = 0, brief = '' }) => {
    const keywords = extractKeywords(`${next.title}\n${brief}\n${source}`, 6);
    const existing = findGenerated(role, anchorId);
    const asset = createCreativeAsset({ id: existing?.id, title: role === 'cover' ? next.title : (brief || next.title), subtitle: role === 'cover' ? next.subtitle : '文章语义场景图', keywords, theme: next.theme, role, index, anchorId });
    const position = next.assets.findIndex(item => item.id === asset.id);
    if (position >= 0) next.assets[position] = asset;
    else next.assets.push(asset);
    generatedAssetIds.push(asset.id);
    return asset;
  };

  let coverAssetId = plan.coverAssetId;
  if (includeCover && !coverAssetId && generate) coverAssetId = addOrUpdateGenerated({ role: 'cover', brief: next.title }).id;
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

  let generatedIndex = 0;
  for (const placement of plan.sectionPlacements) {
    let assetId = placement.assetId;
    if (!assetId && generate) assetId = addOrUpdateGenerated({ role: 'section', anchorId: placement.anchorId, index: generatedIndex++, brief: placement.brief }).id;
    if (!assetId) continue;
    const alreadyPlaced = next.blocks.some(block => block.type === 'image' && block.assetId === assetId && (block.visualAnchor === placement.anchorId || !block.visualAnchor));
    if (alreadyPlaced) continue;
    const asset = next.assets.find(item => item.id === assetId);
    insertAfterAnchor(next.blocks, placement.anchorId, {
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
  }

  // Explicit “图片自动导入” mode also brings in any remaining library images.
  // This is intentionally opt-in so ordinary semantic composition never drops
  // unrelated historical assets into a new article.
  if (fillUnmatched) {
    const usedAssetIds = new Set(next.blocks.flatMap(block => [block.assetId, ...(block.assetIds || [])]).filter(Boolean));
    for (const asset of next.assets.filter(item => !usedAssetIds.has(item.id))) {
      const analysis = recognizeAssetContent(asset);
      next.blocks.push({
        id: randomId(),
        type: 'image',
        assetId: asset.id,
        text: asset.alt || asset.name,
        visualRole: 'library-auto',
        visualMatch: {
          confidence: analysis.confidence,
          matchedKeywords: [],
          matchedLabels: [],
          contentLabels: analysis.labels,
          recognitionSource: analysis.source,
          matchMethod: 'content-recognition-fallback',
          reason: '素材库图片自动填充',
          matchMethod: 'content-recognition-fallback'
        }
      });
      usedAssetIds.add(asset.id);
      plan.sectionPlacements.push({ anchorId: null, assetId: asset.id, role: 'library-auto', reason: '素材库图片自动填充', matchMethod: 'content-recognition-fallback', confidence: analysis.confidence, contentLabels: analysis.labels, recognitionSource: analysis.source });
    }
  }

  const finalAssetAnalyses = next.assets.map(asset => ({ id: asset.id, name: asset.name, ...recognizeAssetContent(asset) }));
  for (const analysis of finalAssetAnalyses) {
    const asset = next.assets.find(item => item.id === analysis.id);
    if (asset) asset.recognition = analysis;
  }

  next.meta = {
    ...(next.meta || {}),
    layoutMode: 'smart',
    visualPlan: {
      version: 1,
      generatedAt: new Date().toISOString(),
      title: titleInfo,
      keywords: plan.keywords,
      assetAnalyses: finalAssetAnalyses,
      recognition: plan.recognition,
      coverAssetId,
      generatedAssetIds: [...new Set(generatedAssetIds)],
      placements: plan.sectionPlacements,
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
