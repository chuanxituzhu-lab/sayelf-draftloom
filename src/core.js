import { autoComposeDocument, createCreativeAsset, summarizeArticle } from './visuals.js';
import { WECHAT_LIMITS, inspectWechatArticle, charCount, truncateByChars } from './wechat-limits.js';

export const MAX_HISTORY = 50;

export const THEMES = Object.freeze({
  minimal: { id: 'minimal', label: '极简', accent: '#07c160', surface: '#f5f7f8', ink: '#303a43', heading: 'system-ui,"PingFang SC","Microsoft YaHei",sans-serif' },
  editorial: { id: 'editorial', label: '杂志', accent: '#9a5b35', surface: '#fbf4ec', ink: '#3f3027', heading: 'Georgia,"Songti SC","SimSun",serif' },
  fresh: { id: 'fresh', label: '清新', accent: '#218a9b', surface: '#effafa', ink: '#21464b', heading: 'system-ui,"PingFang SC","Microsoft YaHei",sans-serif' },
  ink: { id: 'ink', label: '墨韵', accent: '#7657b8', surface: '#f2effb', ink: '#302745', heading: 'Georgia,"Songti SC","SimSun",serif' },
  sunset: { id: 'sunset', label: '暖阳', accent: '#e45f3f', surface: '#fff0e7', ink: '#4a2a22', heading: 'system-ui,"PingFang SC","Microsoft YaHei",sans-serif' }
});

export function normalizeTheme(theme = 'minimal') {
  const value = String(theme).trim().toLowerCase();
  if (THEMES[value]) return value;
  const aliases = { '极简': 'minimal', '杂志': 'editorial', '编辑': 'editorial', '清新': 'fresh', '墨韵': 'ink', '暖阳': 'sunset' };
  return aliases[String(theme).trim()] || 'minimal';
}

export function humanizeText(value = '', mode = 'natural') {
  let text = String(value).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const conservative = [
    [/^众所周知[，,、]\s*/g, ''],
    [/^值得注意的是[，,、]\s*/g, ''],
    [/在这个过程中/g, '在这个过程中'],
    [/在这样的情况下/g, '在这种情况下']
  ];
  const natural = [
    [/^众所周知[，,、]\s*/g, ''],
    [/^值得注意的是[，,、]\s*/g, ''],
    [/^总的来说[，,、]?\s*/g, ''],
    [/^综上所述[，,、]?\s*/g, ''],
    [/在这个过程中/g, '过程中'],
    [/在这种情况下/g, '此时'],
    [/进行(分析|讨论|介绍|说明)/g, '$1'],
    [/我们可以看到/g, '可以看到']
  ];
  for (const [pattern, replacement] of (mode === 'conservative' ? conservative : natural)) text = text.replace(pattern, replacement);
  if (mode !== 'conservative' && text.length > 180) text = text.replace(/([。！？!?])\s*/g, '$1\n');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function humanizeDocument(doc, mode = 'natural') {
  const next = clone(doc);
  let changedBlocks = 0;
  next.title = humanizeText(next.title, mode);
  next.subtitle = humanizeText(next.subtitle, mode);
  next.blocks = next.blocks.map(block => {
    if (!['heading', 'paragraph', 'quote', 'cta'].includes(block.type)) return block;
    const text = humanizeText(block.text, mode);
    if (text !== block.text) { changedBlocks += 1; return { ...block, text }; }
    return block;
  });
  next.meta = { ...next.meta, humanizer: { mode, changedBlocks, appliedAt: new Date().toISOString() } };
  return next;
}

export function createInitialDocument() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: '未命名公众号文章',
    author: '',
    subtitle: '用文字指令与可视化编辑器共同完成排版',
    blocks: [
      { id: crypto.randomUUID(), type: 'heading', text: '从这里开始', level: 2 },
      { id: crypto.randomUUID(), type: 'paragraph', text: '左侧管理结构和素材，中间编辑内容，右侧实时查看微信文章效果。' },
      { id: crypto.randomUUID(), type: 'quote', text: '预览缩放只改变观看比例，不改变文章内容。' }
    ],
    assets: [],
    theme: 'minimal',
    original: null,
    meta: { createdAt: now, updatedAt: now, revision: 1, subtitleSource: 'default' }
  };
}

export function clone(value) {
  return structuredClone(value);
}

export function stamp(doc, revision) {
  doc.meta.updatedAt = new Date().toISOString();
  doc.meta.revision = revision;
  return doc;
}

function imageBasename(value = '') {
  try { return decodeURIComponent(String(value)).split(/[?#]/)[0].split(/[\\/]/).pop().toLowerCase(); }
  catch { return String(value).toLowerCase(); }
}

function assetMatches(asset, reference, alt = '') {
  const ref = imageBasename(reference);
  const name = imageBasename(asset.name);
  const assetAlt = imageBasename(asset.alt || '');
  const wanted = imageBasename(alt);
  return ref && (ref === name || ref === assetAlt || wanted === name || wanted === assetAlt || ref.includes(name) || name.includes(ref));
}

function normalizeImportedAsset(asset) {
  return {
    id: asset.id || crypto.randomUUID(),
    name: asset.name || '未命名图片',
    type: asset.type || 'image/png',
    size: Number(asset.size || 0),
    dataUrl: asset.dataUrl || '',
    alt: asset.alt || String(asset.name || '图片').replace(/\.[^.]+$/, ''),
    ...(asset.caption ? { caption: asset.caption } : {}),
    ...(asset.description ? { description: asset.description } : {}),
    ...(asset.ocrText ? { ocrText: asset.ocrText } : {}),
    ...(asset.labels ? { labels: Array.isArray(asset.labels) ? [...asset.labels] : asset.labels } : {}),
    ...(asset.tags ? { tags: Array.isArray(asset.tags) ? [...asset.tags] : asset.tags } : {}),
    ...(asset.vision && typeof asset.vision === 'object' ? { vision: structuredClone(asset.vision) } : {}),
    ...(asset.width ? { width: Number(asset.width) } : {}),
    ...(asset.height ? { height: Number(asset.height) } : {})
  };
}

function parseFrontMatter(lines) {
  if (lines[0]?.trim() !== '---') return { values: {}, lines };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return { values: {}, lines };
  const values = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^\s*(title|author|subtitle|theme)\s*:\s*(.*?)\s*$/i);
    if (match) values[match[1].toLowerCase()] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return { values, lines: lines.slice(end + 1) };
}

/**
 * Convert Markdown/plain text plus local assets into the document model.
 * The original source is retained so later human edits never destroy it.
 */
export function importArticle({ text = '', filename = 'article.md', assets = [], autoCompose = false, visualOptions = {} } = {}) {
  const source = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const parsed = parseFrontMatter(source.split('\n'));
  const lines = parsed.lines;
  const importedAssets = assets.map(normalizeImportedAsset);
  const usedAssets = new Set();
  const warnings = [];
  const blocks = [];
  let title = parsed.values.title || '';
  const author = parsed.values.author || '';
  const subtitle = parsed.values.subtitle || '自动排版草稿 · 可继续人工编辑';
  const theme = normalizeTheme(parsed.values.theme || 'minimal');
  let buffer = [];

  const flushParagraph = () => {
    const value = buffer.join('\n').trim();
    if (value) blocks.push({ id: crypto.randomUUID(), type: 'paragraph', text: value });
    buffer = [];
  };
  const addImage = (alt, reference) => {
    const cleanReference = String(reference).trim().replace(/^<|>$/g, '');
    let asset = importedAssets.find(item => assetMatches(item, cleanReference, alt));
    if (!asset && cleanReference.startsWith('data:image/')) {
      asset = normalizeImportedAsset({ name: alt || '内嵌图片', type: cleanReference.match(/^data:([^;]+)/)?.[1], dataUrl: cleanReference, alt });
      importedAssets.push(asset);
    }
    if (asset) usedAssets.add(asset.id);
    else warnings.push(`未找到图片素材：${alt || cleanReference}`);
    blocks.push({ id: crypto.randomUUID(), type: 'image', assetId: asset?.id || null, text: alt || asset?.alt || imageBasename(cleanReference) || '图片', source: cleanReference });
  };

  const nonEmptyIndex = lines.findIndex(line => line.trim());
  const firstLine = nonEmptyIndex >= 0 ? lines[nonEmptyIndex].trim() : '';
  const firstLineLooksLikeTitle = !title && firstLine && !/^#{1,6}\s|^>|^[-*+]\s|^\d+[.)]\s/.test(firstLine) && firstLine.length <= 80;
  const titleLineIndex = firstLineLooksLikeTitle ? nonEmptyIndex : -1;
  if (firstLineLooksLikeTitle) title = firstLine;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    if (index === titleLineIndex) continue;
    if (!line.trim()) { flushParagraph(); continue; }

    const fenced = line.match(/^\s*:::(table|cta|gallery|media)\s*$/i);
    if (fenced) {
      flushParagraph();
      const kind = fenced[1].toLowerCase();
      const payload = [];
      let cursor = index + 1;
      while (cursor < lines.length && lines[cursor].trim() !== ':::') { payload.push(lines[cursor]); cursor += 1; }
      const values = {};
      for (const payloadLine of payload) {
        const match = payloadLine.match(/^\s*([a-zA-Z]+)\s*:\s*(.*?)\s*$/);
        if (match) values[match[1].toLowerCase()] = match[2];
      }
      if (kind === 'table') {
        const rows = payload.filter(item => item.includes('|')).map(item => item.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()));
        if (rows.length) blocks.push({ id: crypto.randomUUID(), type: 'table', text: values.title || '数据表格', headers: rows[0], rows: rows.slice(1) });
      } else if (kind === 'cta') {
        blocks.push({ id: crypto.randomUUID(), type: 'cta', text: values.text || payload.find(item => item.trim()) || '欢迎继续阅读', buttonText: values.button || '立即了解', href: values.url || values.href || '' });
      } else if (kind === 'media') {
        blocks.push({ id: crypto.randomUUID(), type: 'media', text: values.text || '媒体内容', mediaType: values.type || 'video', url: values.url || payload.find(item => item.trim()) || '' });
      } else {
        const names = (values.images || payload.join(',')).split(/[,，]/).map(item => item.trim()).filter(Boolean);
        const assetIds = names.map(name => importedAssets.find(asset => assetMatches(asset, name, name))?.id).filter(Boolean);
        assetIds.forEach(id => usedAssets.add(id));
        blocks.push({ id: crypto.randomUUID(), type: 'gallery', text: values.text || '图片组', assetIds });
      }
      index = cursor < lines.length ? cursor : lines.length - 1;
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      if (level === 1 && !title) title = heading[2].trim();
      else if (level > 1) blocks.push({ id: crypto.randomUUID(), type: 'heading', text: heading[2].trim(), level: Math.min(level, 3) });
      continue;
    }
    const image = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (image) { flushParagraph(); addImage(image[1].trim(), image[2].trim()); continue; }
    const tableDivider = lines[index + 1]?.match(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/);
    if (line.includes('|') && tableDivider) {
      flushParagraph();
      const parseRow = value => value.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
      const headers = parseRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) { rows.push(parseRow(lines[index])); index += 1; }
      index -= 1;
      blocks.push({ id: crypto.randomUUID(), type: 'table', text: '数据表格', headers, rows });
      continue;
    }
    const listItem = line.match(/^\s*([-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (listItem) {
      flushParagraph();
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*([-*+]\s+|\d+[.)]\s+)(.+)$/);
        if (!item || (/^\s*\d/.test(lines[index]) !== ordered)) break;
        items.push(item[2].trim()); index += 1;
      }
      index -= 1;
      blocks.push({ id: crypto.randomUUID(), type: 'list', text: items.join('\n'), items, ordered });
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1\s*$/.test(line)) { flushParagraph(); continue; }
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quoteLines = [line.replace(/^\s*>\s?/, '')];
      blocks.push({ id: crypto.randomUUID(), type: 'quote', text: quoteLines.join('\n').trim() });
      continue;
    }
    const inlineImage = /!\[([^\]]*)\]\(([^)]+)\)/g;
    if (inlineImage.test(line)) buffer.push(line.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1').trim());
    else buffer.push(line);
  }
  flushParagraph();

  if (!title) title = '未命名公众号文章';
  const cover = importedAssets.find(asset => !usedAssets.has(asset.id) && /cover|封面/i.test(asset.name));
  if (cover) {
    blocks.unshift({ id: crypto.randomUUID(), type: 'image', assetId: cover.id, text: cover.alt || cover.name, visualRole: 'cover' });
    usedAssets.add(cover.id);
  }
  for (const asset of importedAssets) {
    if (usedAssets.has(asset.id)) continue;
    if (autoCompose) continue;
    blocks.push({ id: crypto.randomUUID(), type: 'image', assetId: asset.id, text: asset.alt || asset.name });
    warnings.push(`图片未在原文中引用，已追加到文章末尾：${asset.name}`);
  }
  if (!blocks.length && source.trim()) blocks.push({ id: crypto.randomUUID(), type: 'paragraph', text: source.trim() });

  const now = new Date().toISOString();
  const document = {
    id: crypto.randomUUID(),
    title,
    author,
    subtitle,
    blocks,
    assets: importedAssets,
    theme,
    original: { filename, text: source, importedAt: now },
    meta: { createdAt: now, updatedAt: now, revision: 1, importedFrom: filename, importWarnings: warnings, layoutMode: 'auto', subtitleSource: 'auto' }
  };
  return autoCompose ? autoComposeDocument(document, visualOptions) : document;
}

export function getLayoutGuidance(doc) {
  const suggestions = [];
  const wechatValidation = inspectWechatArticle({ title: doc.title, author: doc.author || '', digest: doc.subtitle || '', content: renderArticleHtml(doc) });
  for (const error of wechatValidation.errors) suggestions.push({ level: 'error', text: `微信限制：${error.message}`, command: '' });
  const paragraphs = doc.blocks.filter(block => block.type === 'paragraph');
  const longParagraph = paragraphs.find(block => block.text.length > 260);
  if (!doc.title || doc.title === '未命名公众号文章') suggestions.push({ level: 'warning', text: '请补充一个明确标题。', command: '标题：输入文章标题' });
  if (longParagraph) suggestions.push({ level: 'review', text: '发现较长段落，建议拆分以提升手机阅读节奏。', command: '拆分当前段落' });
  const hasHeading = doc.blocks.some(block => block.type === 'heading');
  if (!hasHeading && paragraphs.length >= 3) suggestions.push({ level: 'review', text: '文章缺少章节层级，建议添加 1–3 个小标题。', command: '添加标题：章节标题' });
  const imageCount = doc.blocks.filter(block => block.type === 'image').length;
  if (imageCount > 5) suggestions.push({ level: 'review', text: `当前有 ${imageCount} 张图片，建议人工确认节奏和位置。`, command: '上移当前' });
  const missing = doc.blocks.filter(block => block.type === 'image' && !block.assetId);
  if (missing.length) suggestions.push({ level: 'error', text: `有 ${missing.length} 个图片引用未匹配素材，请补充同名文件。`, command: '' });
  const componentCount = doc.blocks.filter(block => ['table', 'cta', 'gallery', 'media'].includes(block.type)).length;
  if (componentCount > 4) suggestions.push({ level: 'review', text: '高级组件较多，建议检查信息密度和手机端滚动节奏。', command: '下移当前' });
  if (doc.meta?.titlePlan?.candidates?.length && doc.meta.titlePlan.applied !== false && doc.meta.titleLocked !== true) {
    suggestions.push({ level: 'review', text: `已生成 ${doc.meta.titlePlan.candidates.length} 个爆款标题候选，发布前请选择或确认一个。`, command: '爆款标题' });
  }
  for (const hint of (doc.meta?.visualPlan?.suggestions || []).slice(0, 3)) suggestions.push({ level: 'review', text: hint, command: '智能配图' });
  if (!suggestions.length) suggestions.push({ level: 'ok', text: '当前结构适合继续人工微调。', command: '' });
  return suggestions;
}

function fitWechatText(value, max) {
  const text = String(value || '').trim();
  if (charCount(text) <= max) return { value: text, changed: false };
  const sentences = text.split(/(?<=[。！？!?])\s*/).map(item => item.trim()).filter(Boolean);
  let prefix = '';
  for (const sentence of sentences) {
    const candidate = `${prefix}${sentence}`;
    if (charCount(candidate) > max) break;
    prefix = candidate;
  }
  if (charCount(prefix) >= Math.min(max, 12)) return { value: prefix, changed: true };
  return { value: `${truncateByChars(text, Math.max(0, max - 1))}…`, changed: true };
}

function distillText(value = '') {
  let text = String(value || '').replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const replacements = [
    [/^(?:众所周知|值得注意的是|总的来说|综上所述)[，,、]?\s*/g, ''],
    [/需要注意的是[，,、]?\s*/g, ''],
    [/在这个过程中/g, '过程中'],
    [/在这样的情况下/g, '此时'],
    [/进行(?:了)?(分析|讨论|介绍|说明)/g, '$1'],
    [/我们可以看到/g, '可以看到'],
    [/换句话说[，,、]?\s*/g, '']
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  const units = text.split(/(?<=[。！？!?；;])\s*|\n+/).map(item => item.trim()).filter(Boolean);
  if (units.length < 2) return text;
  const seen = new Set();
  return units.filter(unit => {
    const key = unit.replace(/[，。！？!?；;：:、\s]/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('');
}

function distillToLimit(value, max) {
  const text = distillText(value);
  if (charCount(text) <= max) return text;
  const units = text.split(/(?<=[。！？!?；;])\s*|\n+/).map(item => item.trim()).filter(Boolean);
  if (units.length < 3) {
    const head = Math.max(1, Math.floor((max - 1) / 2));
    const tail = Math.max(1, max - head - 1);
    return `${truncateByChars(text, head)}…${[...text].slice(-tail).join('')}`;
  }
  const head = truncateByChars(units.slice(0, 2).join(''), Math.max(24, Math.floor(max * 0.35)));
  const tail = truncateByChars(units.slice(-2).join(''), Math.max(24, Math.floor(max * 0.35)));
  const middleBudget = Math.max(0, max - charCount(head) - charCount(tail) - 2);
  const middleUnits = [];
  const stride = Math.max(1, Math.floor(units.length / 8));
  for (let index = stride; index < units.length - 2; index += stride) middleUnits.push(units[index]);
  const middle = truncateByChars(middleUnits.join(''), middleBudget);
  return [head, middle, tail].filter(Boolean).join('…');
}

function blockText(block = {}) {
  if (block.type === 'list') return (block.items || String(block.text || '').split('\n')).join('；');
  return String(block.text || '');
}

function setBlockText(block, value) {
  const text = String(value || '').trim();
  if (block.type === 'list') {
    block.items = text.split(/；|\n/).map(item => item.trim()).filter(Boolean);
    block.text = block.items.join('\n');
  } else block.text = text;
}

function compactWechatBlocks(doc, maxChars = 420) {
  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
  const compacted = [];
  let changed = 0;
  for (const block of blocks) {
    const previous = compacted.at(-1);
    if (previous?.type === 'paragraph' && block.type === 'paragraph') {
      const previousText = blockText(previous);
      const nextText = blockText(block);
      if (previousText && nextText && charCount(previousText) + charCount(nextText) + 1 <= maxChars) {
        previous.text = `${previousText}\n${nextText}`;
        changed += 1;
        continue;
      }
    }
    compacted.push(block);
  }
  if (changed) doc.blocks = compacted;
  return changed;
}

function distillWechatBody(doc, targetChars = 18_000) {
  const eligible = (doc.blocks || []).filter(block => ['heading', 'paragraph', 'quote', 'cta', 'media', 'list'].includes(block.type));
  let changedBlocks = 0;
  for (const block of eligible) {
    const before = blockText(block);
    const after = distillText(before);
    if (after !== before) { setBlockText(block, after); changedBlocks += 1; }
  }
  // A long article imported from OCR often contains dozens of very short
  // paragraph blocks. Their repeated inline-style wrappers can push the
  // draft HTML over WeChat's 20,000-character limit even after the text is
  // distilled. Merge adjacent short paragraphs for delivery while keeping
  // line breaks, images, headings, and the protected original intact.
  changedBlocks += compactWechatBlocks(doc);
  const measure = () => inspectWechatArticle({ content: renderArticleHtml(doc) }).fields.contentChars;
  let contentChars = measure();
  let guard = 0;
  while (contentChars > targetChars && eligible.length && guard < eligible.length * 3 + 6) {
    const candidate = eligible
      .filter(block => charCount(blockText(block)) > 16)
      .sort((a, b) => charCount(blockText(b)) - charCount(blockText(a)))[0];
    if (!candidate) break;
    const current = blockText(candidate);
    const reduction = Math.max(48, Math.ceil((contentChars - targetChars) / 2));
    const minimum = candidate.type === 'heading' ? 8 : 12;
    const max = Math.max(minimum, charCount(current) - reduction);
    const fitted = distillToLimit(current, max);
    if (fitted === current) {
      const fallback = truncateByChars(current, Math.max(minimum, max - 1));
      if (fallback === current) break;
      setBlockText(candidate, `${fallback}…`);
    } else setBlockText(candidate, fitted);
    changedBlocks += 1;
    contentChars = measure();
    guard += 1;
  }
  return { changed: changedBlocks > 0, changedBlocks, contentChars, targetChars };
}

function splitLargeUnit(value, targetChars) {
  const text = String(value || '');
  if (charCount(text) <= targetChars) return [text];
  const chars = [...text];
  const chunks = [];
  for (let index = 0; index < chars.length; index += targetChars) chunks.push(chars.slice(index, index + targetChars).join(''));
  return chunks;
}

function buildWechatSeriesPlan(doc, targetChars = 18_000) {
  const parts = [];
  let current = { part: 1, blockIds: [], approxChars: 0 };
  for (const block of doc.blocks || []) {
    const raw = block.text || (block.items || []).join('；') || '';
    const units = String(raw).split(/(?<=[。！？!?])\s*|\n+/).map(item => item.trim()).filter(Boolean);
    const values = (units.length ? units : [String(raw)]).flatMap(value => splitLargeUnit(value, targetChars));
    for (const value of values) {
      const cost = Math.max(1, charCount(value));
      if (current.blockIds.length && current.approxChars + cost > targetChars) {
        parts.push(current);
        current = { part: parts.length + 1, blockIds: [], approxChars: 0 };
      }
      if (!current.blockIds.includes(block.id)) current.blockIds.push(block.id);
      current.approxChars += cost;
    }
  }
  if (current.blockIds.length) parts.push(current);
  return { targetChars, parts: parts.map(part => ({ ...part, suggestedTitle: `第 ${part.part} 篇：${doc.title || '系列文章'}` })), count: parts.length };
}

/**
 * Apply safe, reversible metadata and body distillation fixes for WeChat.
 * The original body is copied into optimization metadata before distillation;
 * a long body also receives a series split plan so no content is silently lost.
 */
export function optimizeWechatDocument(doc) {
  const next = clone(doc);
  const changes = [];
  const titleCandidates = next.meta?.titlePlan?.candidates || [];
  if (next.meta?.titleLocked !== true) {
    const candidate = titleCandidates.find(item => charCount(item.title || '') <= WECHAT_LIMITS.titleChars)?.title;
    if (candidate && candidate !== next.title) {
      next.title = candidate;
      next.meta = { ...(next.meta || {}), titleSource: 'wechat-auto', titlePlan: { ...(next.meta?.titlePlan || {}), selected: candidate, applied: true } };
      changes.push('标题已根据内容摘要智能优化');
    }
  }
  if (charCount(next.title || '') > WECHAT_LIMITS.titleChars) {
    const candidate = titleCandidates.find(item => charCount(item.title || '') <= WECHAT_LIMITS.titleChars)?.title;
    const fitted = candidate || fitWechatText(next.title, WECHAT_LIMITS.titleChars).value;
    next.title = fitted;
    next.meta = { ...(next.meta || {}), titleLocked: true, titleSource: 'wechat-auto' };
    changes.push(`标题已压缩到 ${WECHAT_LIMITS.titleChars} 字内`);
  }
  const author = fitWechatText(next.author || '', WECHAT_LIMITS.authorChars);
  if (author.changed) { next.author = author.value; changes.push(`作者已压缩到 ${WECHAT_LIMITS.authorChars} 字内`); }
  const digest = fitWechatText(next.subtitle || '', WECHAT_LIMITS.digestChars);
  if (digest.changed) { next.subtitle = digest.value; changes.push(`摘要已压缩到 ${WECHAT_LIMITS.digestChars} 字内`); }
  const originalBody = clone(next.blocks || []);
  const originalValidation = inspectWechatArticle({ title: next.title, author: next.author || '', digest: next.subtitle || '', content: renderArticleHtml(next) });
  const originalBodyTooLong = originalValidation.errors.some(item => item.id === 'contentChars' || item.id === 'contentBytes');
  const seriesPlan = originalBodyTooLong ? buildWechatSeriesPlan({ ...next, blocks: originalBody }) : null;
  const distillation = distillWechatBody(next);
  if (distillation.changed) changes.push(`正文已蒸馏提炼 ${distillation.changedBlocks} 个区块，保留结构与原稿`);
  if (next.meta?.subtitleLocked !== true && ['default', 'auto', undefined].includes(next.meta?.subtitleSource)) {
    const bodyText = (next.blocks || []).filter(block => block.type !== 'image').map(block => block.text || (block.items || []).join('；')).filter(Boolean).join('\n');
    const distilledSummary = summarizeArticle({ text: bodyText, title: next.title, max: WECHAT_LIMITS.digestChars });
    if (distilledSummary && distilledSummary !== next.subtitle) {
      next.subtitle = distilledSummary;
      next.meta = { ...(next.meta || {}), subtitleSource: 'auto' };
      changes.push('摘要已根据蒸馏后的正文智能更新');
    }
  }
  const coverBlock = next.blocks.find(block => block.type === 'image' && (block.visualRole === 'cover' || block.id === next.blocks.find(item => item.type === 'image')?.id));
  const coverAsset = coverBlock ? next.assets.find(asset => asset.id === coverBlock.assetId) : null;
  if (coverAsset && next.meta?.coverCopyLocked !== true) {
    const coverMain = fitWechatText(next.title || coverAsset.alt || '', WECHAT_LIMITS.titleImage.mainChars).value;
    const coverSub = fitWechatText(next.subtitle || '', WECHAT_LIMITS.titleImage.subChars).value;
    const copyChanged = coverAsset.coverMain !== coverMain || coverAsset.coverSub !== coverSub;
    const generatedNeedsRefresh = coverAsset.generated && coverAsset.source === 'draftloom:creative-local' && coverAsset.theme !== next.theme;
    if (copyChanged || generatedNeedsRefresh) {
      if (coverAsset.generated && coverAsset.source === 'draftloom:creative-local') {
        const refreshed = createCreativeAsset({ id: coverAsset.id, title: coverMain, subtitle: coverSub, keywords: next.meta?.visualPlan?.keywords || [], theme: next.theme, role: 'cover' });
        Object.assign(coverAsset, { ...refreshed, recognition: coverAsset.recognition });
      } else {
        coverAsset.coverMain = coverMain;
        coverAsset.coverSub = coverSub;
      }
      changes.push('封面图片位置与主/副文案已同步更新');
    }
  }
  const validation = inspectWechatArticle({ title: next.title, author: next.author || '', digest: next.subtitle || '', content: renderArticleHtml(next) });
  const bodyStillTooLong = validation.errors.some(item => item.id === 'contentChars' || item.id === 'contentBytes');
  if (seriesPlan) changes.push(`原正文超限，已生成 ${seriesPlan.count} 篇系列拆分建议；原稿已保留`);
  if (bodyStillTooLong && !seriesPlan) changes.push(`蒸馏后正文仍超限，已生成 ${buildWechatSeriesPlan(next).count} 篇系列拆分建议`);
  const finalSeriesPlan = seriesPlan || (bodyStillTooLong ? buildWechatSeriesPlan(next) : null);
  const protectedBody = next.meta?.wechatOptimization?.protectedOriginalBody || (originalBodyTooLong ? originalBody : null);
  next.meta = { ...(next.meta || {}), wechatOptimization: {
    at: new Date().toISOString(),
    changes,
    remaining: validation.errors.map(item => item.message),
    originalValidation,
    distilled: distillation,
    seriesPlan: finalSeriesPlan,
    protectedOriginalBody: protectedBody
  } };
  return { doc: next, changes, validation, seriesPlan: finalSeriesPlan, originalValidation, distillation };
}

export function parseCommand(input) {
  const raw = input.trim();
  if (!raw) return { type: 'noop' };

  let m;
  const typeMap = { '标题': 'heading', '段落': 'paragraph', '引用': 'quote', '列表': 'list', '表格': 'table', 'CTA': 'cta', 'cta': 'cta', '画廊': 'gallery', '媒体': 'media' };
  if ((m = raw.match(/^(?:标题|设置标题)[：:]?\s*(.+)$/i))) return { type: 'setTitle', text: m[1].trim() };
  if ((m = raw.match(/^(?:副标题|设置副标题)[：:]?\s*(.+)$/i))) return { type: 'setSubtitle', text: m[1].trim() };
  if ((m = raw.match(/^(?:新增|添加)(?:一个)?(?:二级)?标题[：:]?\s*(.+)$/i))) return { type: 'appendBlock', blockType: 'heading', level: 2, text: m[1].trim() };
  if ((m = raw.match(/^(?:新增|添加)(?:一个)?段落[：:]?\s*(.+)$/i))) return { type: 'appendBlock', blockType: 'paragraph', text: m[1].trim() };
  if ((m = raw.match(/^(?:新增|添加)(?:一个)?引用[：:]?\s*(.+)$/i))) return { type: 'appendBlock', blockType: 'quote', text: m[1].trim() };
  if ((m = raw.match(/^(?:新增|添加)(?:一个)?列表[：:]?\s*([\s\S]+)$/i))) return { type: 'appendBlock', blockType: 'list', text: m[1].trim(), items: m[1].split(/[\n；;]+/).map(item => item.trim()).filter(Boolean), ordered: false };
  if ((m = raw.match(/^(?:新增|添加)(?:一个)?表格[：:]?\s*([\s\S]+)$/i))) {
    const rows = m[1].split(/[\n；;]+/).map(row => row.split('|').map(cell => cell.trim()).filter(Boolean)).filter(row => row.length);
    return { type: 'appendBlock', blockType: 'table', text: '数据表格', headers: rows[0] || ['列1', '列2'], rows: rows.slice(1) };
  }
  if ((m = raw.match(/^(?:新增|添加)(?:一个)?CTA[：:]?\s*([\s\S]+)$/i))) {
    const [text, buttonText, href] = m[1].split('|').map(value => value.trim());
    return { type: 'appendBlock', blockType: 'cta', text: text || '欢迎继续阅读', buttonText: buttonText || '立即了解', href: href || '' };
  }
  if ((m = raw.match(/^(?:新增|添加)(?:一个)?画廊[：:]?\s*([\s\S]+)$/i))) return { type: 'appendBlock', blockType: 'gallery', text: '图片组', assetNames: m[1].split(/[,，；;]+/).map(item => item.trim()).filter(Boolean) };
  if ((m = raw.match(/^(?:新增|添加)(?:一个)?媒体[：:]?\s*([\s\S]+)$/i))) {
    const [mediaType, url, text] = m[1].split('|').map(value => value.trim());
    return { type: 'appendBlock', blockType: 'media', text: text || '媒体内容', mediaType: mediaType || 'video', url: url || '' };
  }
  if ((m = raw.match(/^(?:把|将)(?:当前|选中)(?:块|内容)?改(?:成|为)(标题|段落|引用|列表|表格|CTA|画廊|媒体)(?:[：:]\s*(.*))?$/i))) return { type: 'convertSelected', blockType: typeMap[m[1]], text: m[2]?.trim() || undefined };
  if ((m = raw.match(/^第\s*(\d+)\s*(?:个)?(?:段落|段|区块|块)?改(?:成|为)(标题|段落|引用|列表|表格|CTA|画廊|媒体)(?:[：:]\s*(.*))?$/i))) return { type: 'convertBlockAt', index: Number(m[1]) - 1, blockType: typeMap[m[2]], text: m[3]?.trim() || undefined };
  if (/^(?:拆分|分割)(?:当前|选中)?(?:段落|内容|块)?$/i.test(raw)) return { type: 'splitSelected' };
  if ((m = raw.match(/^(?:主题|样式)[：:]?\s*(.+)$/i))) return { type: 'setTheme', theme: normalizeTheme(m[1].trim()) };
  if ((m = raw.match(/^(?:去\s*AI\s*味|自然化|润色)(?:[：:]?\s*(保守|自然|conservative|natural))?$/i))) return { type: 'humanize', mode: /保守|conservative/i.test(m[1] || '') ? 'conservative' : 'natural' };
  if (/^(?:智能配图|自动配图|生成标题图|自动标题(?:图文)?)$/i.test(raw)) return { type: 'autoComposeVisuals', generate: true, maxGenerated: 3, titleMode: 'viral' };
  // The former import-style command is intentionally retired so it cannot
  // accidentally append the phrase as a paragraph. Use “封面一键设置”.
  if (/^封面一键入库$/i.test(raw)) return { type: 'noop' };
  if (/^(?:封面一键设置|一键设置封面|智能设置封面|自动设置封面)$/i.test(raw)) return { type: 'smartCover' };
  if (/^(?:爆款标题|智能标题|生成爆款标题)$/i.test(raw)) return { type: 'autoComposeVisuals', generate: false, maxGenerated: 0, titleMode: 'viral', forceTitle: true };
  if (/^(?:智能自动化)?(?:优化|修正|调整)(?:修改)?(?:执行)?(?:微信公众号|微信|公众号)?(?:发布)?(?:约束|限制)$/i.test(raw) || /^(?:智能优化|自动优化)(?:微信|公众号)?(?:发布)?(?:约束|限制)$/i.test(raw)) return { type: 'optimizeWechat' };
  if (/^(?:图片智能导入|图片自动导入|自动导入图片|自动填充图片|自动填充素材)$/i.test(raw)) return { type: 'autoComposeVisuals', generate: false, maxGenerated: 0, fillUnmatched: true, titleMode: 'safe' };
  if ((m = raw.match(/^删除(?:当前|选中)(?:块|段落|内容)?$/i))) return { type: 'deleteSelected' };
  if (/^(?:上移|向上移动)(?:当前|选中)?/i.test(raw)) return { type: 'moveSelected', direction: -1 };
  if (/^(?:下移|向下移动)(?:当前|选中)?/i.test(raw)) return { type: 'moveSelected', direction: 1 };
  if ((m = raw.match(/^插入图片[：:]?\s*(.+)$/i))) return { type: 'insertAssetByName', name: m[1].trim() };
  if ((m = raw.match(/^(?:替换|更换)(?:当前|选中)?图片[：:]?\s*(.+)$/i))) return { type: 'replaceSelectedAssetByName', name: m[1].trim() };
  return { type: 'appendBlock', blockType: 'paragraph', text: raw };
}

function blockFromIntent(intent, doc) {
  const block = { id: crypto.randomUUID(), type: intent.blockType, text: intent.text || '' };
  if (intent.level) block.level = intent.level;
  if (intent.blockType === 'list') {
    block.items = intent.items || String(intent.text || '').split(/[\n；;]+/).map(item => item.trim()).filter(Boolean);
    block.text = block.items.join('\n');
    block.ordered = Boolean(intent.ordered);
  }
  if (intent.blockType === 'table') {
    block.headers = intent.headers || ['列1', '列2'];
    block.rows = intent.rows || [];
    block.text = intent.text || '数据表格';
  }
  if (intent.blockType === 'cta') {
    block.buttonText = intent.buttonText || '立即了解';
    block.href = intent.href || '';
  }
  if (intent.blockType === 'gallery') {
    block.assetIds = (intent.assetIds || intent.assetNames || []).map(value => {
      if (doc.assets.some(asset => asset.id === value)) return value;
      return doc.assets.find(asset => asset.name.toLowerCase().includes(String(value).toLowerCase()))?.id;
    }).filter(Boolean);
  }
  if (intent.blockType === 'media') {
    block.mediaType = intent.mediaType || 'video';
    block.url = intent.url || '';
  }
  return block;
}

function convertedBlock(block, intent) {
  const next = { id: block.id, type: intent.blockType, text: intent.text ?? block.text ?? '' };
  if (intent.blockType === 'heading') next.level = 2;
  if (intent.blockType === 'list') { next.items = String(next.text).split(/[\n。！？!?；;]+/).map(item => item.trim()).filter(Boolean); next.text = next.items.join('\n'); next.ordered = false; }
  if (intent.blockType === 'table') { next.headers = ['内容', '备注']; next.rows = [[next.text, '']]; next.text = '数据表格'; }
  if (intent.blockType === 'cta') { next.buttonText = block.buttonText || '立即了解'; next.href = block.href || ''; }
  if (intent.blockType === 'gallery') next.assetIds = block.assetIds || (block.assetId ? [block.assetId] : []);
  if (intent.blockType === 'media') { next.mediaType = block.mediaType || 'video'; next.url = block.url || ''; }
  return next;
}

export function reduceDocument(doc, intent, selectedId = null) {
  const next = clone(doc);
  let selected = selectedId;
  let changed = true;

  switch (intent.type) {
    case 'noop': return { doc, selectedId, changed: false };
    case 'setTitle':
      next.title = intent.text;
      next.meta = { ...(next.meta || {}), titleLocked: true, titleSource: 'human' };
      break;
    case 'setAuthor': next.author = intent.text; break;
    case 'setSubtitle':
      next.subtitle = intent.text;
      next.meta = { ...(next.meta || {}), subtitleLocked: true, subtitleSource: 'human' };
      break;
    case 'setTheme': {
      const theme = normalizeTheme(intent.theme);
      if (theme === normalizeTheme(next.theme)) return { doc, selectedId, changed: false };
      next.theme = theme;
      break;
    }
    case 'humanize': {
      const humanized = humanizeDocument(next, intent.mode || 'natural');
      return { doc: humanized, selectedId, changed: true };
    }
    case 'autoComposeVisuals': {
      const composed = autoComposeDocument(next, {
        generate: intent.generate !== false,
        maxGenerated: Number.isFinite(Number(intent.maxGenerated)) ? Number(intent.maxGenerated) : 3,
        includeCover: intent.includeCover !== false,
        titleMode: intent.titleMode || 'safe',
        forceTitle: intent.forceTitle === true,
        titleProfile: intent.titleProfile || {},
        fillUnmatched: intent.fillUnmatched === true
      });
      return { doc: composed, selectedId: composed.blocks[0]?.id || selectedId, changed: true };
    }
    case 'smartCover': {
      const composed = autoComposeDocument(next, {
        generate: true,
        maxGenerated: 0,
        includeCover: true,
        titleMode: 'safe',
        forceTitle: false,
        fillUnmatched: false
      });
      const coverAssetId = composed.meta?.visualPlan?.coverAssetId;
      if (coverAssetId) {
        const coverResult = reduceDocument(composed, { type: 'setCoverAsset', assetId: coverAssetId }, selectedId);
        return { doc: coverResult.doc, selectedId: coverResult.selectedId, changed: true };
      }
      return { doc: composed, selectedId: composed.blocks[0]?.id || selectedId, changed: true };
    }
    case 'optimizeWechat': {
      const optimized = optimizeWechatDocument(next);
      return { doc: optimized.doc, selectedId, changed: optimized.changes.length > 0, optimization: optimized };
    }
    case 'appendBlock': {
      const block = blockFromIntent(intent, next);
      next.blocks.push(block); selected = block.id; break;
    }
    case 'updateBlock': {
      const block = next.blocks.find(b => b.id === intent.id);
      if (!block) return { doc, selectedId, changed: false };
      let updated = false;
      if (intent.text !== undefined && block.text !== intent.text) { block.text = intent.text; updated = true; }
      for (const field of ['items', 'ordered', 'headers', 'rows', 'buttonText', 'href', 'assetIds', 'mediaType', 'url']) {
        if (intent[field] !== undefined && JSON.stringify(block[field]) !== JSON.stringify(intent[field])) { block[field] = intent[field]; updated = true; }
      }
      if (!updated) return { doc, selectedId, changed: false };
      selected = block.id; break;
    }
    case 'convertSelected': {
      if (!selectedId) return { doc, selectedId, changed: false };
      const index = next.blocks.findIndex(block => block.id === selectedId);
      if (index < 0) return { doc, selectedId, changed: false };
      next.blocks[index] = convertedBlock(next.blocks[index], intent); selected = selectedId; break;
    }
    case 'convertBlockAt': {
      if (intent.index < 0 || intent.index >= next.blocks.length) return { doc, selectedId, changed: false, error: '找不到对应区块' };
      const block = next.blocks[intent.index];
      next.blocks[intent.index] = convertedBlock(block, intent); selected = block.id; break;
    }
    case 'splitSelected': {
      const index = next.blocks.findIndex(block => block.id === selectedId);
      const block = index >= 0 ? next.blocks[index] : null;
      if (!block || !block.text || block.text.length < 2) return { doc, selectedId, changed: false, error: '当前区块没有足够文字可拆分' };
      let parts = block.text.split(/\n+|(?<=[。！？!?])\s*/).map(item => item.trim()).filter(Boolean);
      if (parts.length < 2) { const pivot = Math.ceil(block.text.length / 2); parts = [block.text.slice(0, pivot), block.text.slice(pivot)]; }
      const replacements = parts.map(text => ({ id: crypto.randomUUID(), type: 'paragraph', text }));
      next.blocks.splice(index, 1, ...replacements); selected = replacements[0].id; break;
    }
    case 'deleteSelected': {
      if (!selectedId) return { doc, selectedId, changed: false };
      const index = next.blocks.findIndex(b => b.id === selectedId);
      if (index < 0) return { doc, selectedId, changed: false };
      next.blocks.splice(index, 1);
      selected = next.blocks[index]?.id || next.blocks[index - 1]?.id || null;
      break;
    }
    case 'moveSelected': {
      const index = next.blocks.findIndex(b => b.id === selectedId);
      const target = index + intent.direction;
      if (index < 0 || target < 0 || target >= next.blocks.length) return { doc, selectedId, changed: false };
      [next.blocks[index], next.blocks[target]] = [next.blocks[target], next.blocks[index]];
      break;
    }
    case 'addAsset': {
      if (next.assets.some(a => a.id === intent.asset.id)) return { doc, selectedId, changed: false };
      next.assets.push(intent.asset); break;
    }
    case 'setCoverAsset': {
      const asset = next.assets.find(item => item.id === intent.assetId);
      if (!asset) return { doc, selectedId, changed: false, error: '封面素材不存在' };
      // Older library entries may not have persisted dimensions. The dedicated
      // WeChat cover slot normalizes them to the frozen 900×383 head-image spec.
      if (!asset.width || !asset.height) { asset.width = 900; asset.height = 383; }
      const existing = next.blocks.find(block => block.type === 'image' && block.assetId === asset.id);
      const coverBlock = existing || {
        id: crypto.randomUUID(),
        type: 'image',
        assetId: asset.id,
        text: asset.alt || asset.name || '公众号封面'
      };
      coverBlock.visualRole = 'cover';
      coverBlock.generatedBy = asset.generated ? (coverBlock.generatedBy || 'autoComposeVisuals') : undefined;
      next.blocks = next.blocks.filter(block => !(block.type === 'image' && block.visualRole === 'cover' && block.assetId !== asset.id));
      const existingIndex = next.blocks.findIndex(block => block.id === coverBlock.id);
      if (existingIndex >= 0) next.blocks.splice(existingIndex, 1);
      next.blocks.unshift(coverBlock);
      asset.visualRole = 'cover';
      next.meta = {
        ...(next.meta || {}),
        visualPlan: {
          ...(next.meta?.visualPlan || {}),
          coverAssetId: asset.id,
          provider: asset.source || next.meta?.visualPlan?.provider || 'local'
        },
        coverCopyLocked: false
      };
      break;
    }
    case 'setCoverCopy': {
      const coverAsset = getCoverAsset(next);
      if (!coverAsset) return { doc, selectedId, changed: false, error: '请先设置封面素材' };
      const main = fitWechatText(intent.main ?? coverAsset.coverMain ?? next.title ?? '', WECHAT_LIMITS.titleImage.mainChars).value;
      const sub = fitWechatText(intent.sub ?? coverAsset.coverSub ?? next.subtitle ?? '', WECHAT_LIMITS.titleImage.subChars).value;
      if (coverAsset.coverMain === main && coverAsset.coverSub === sub) return { doc, selectedId, changed: false };
      coverAsset.coverMain = main;
      coverAsset.coverSub = sub;
      coverAsset.visualRole = 'cover';
      next.meta = { ...(next.meta || {}), coverCopyLocked: true };
      break;
    }
    case 'addAssets': {
      const assets = Array.isArray(intent.assets) ? intent.assets : [];
      const incoming = assets.filter(asset => asset?.id && !next.assets.some(existing => existing.id === asset.id));
      if (!incoming.length) return { doc, selectedId, changed: false };
      next.assets.push(...incoming);
      break;
    }
    case 'deleteAsset': {
      const assetId = intent.assetId;
      const asset = next.assets.find(item => item.id === assetId);
      if (!asset) return { doc, selectedId, changed: false, error: '素材不存在' };

      // 删除素材时同时清理文章中的图片引用，避免素材虽从库中移除但
      // 图片仍在文章中、刷新后又被本地持久化状态带回来的情况。
      const previousBlocks = next.blocks;
      const removedBlockIds = new Set();
      next.blocks = previousBlocks.flatMap(block => {
        if (block.type === 'image' && block.assetId === assetId) {
          removedBlockIds.add(block.id);
          return [];
        }
        if (!Array.isArray(block.assetIds) || !block.assetIds.includes(assetId)) return [block];
        const remainingAssetIds = block.assetIds.filter(id => id !== assetId);
        if (block.type === 'gallery' && remainingAssetIds.length === 0) {
          removedBlockIds.add(block.id);
          return [];
        }
        block.assetIds = remainingAssetIds;
        return [block];
      });
      next.assets = next.assets.filter(item => item.id !== assetId);
      if (removedBlockIds.has(selected)) {
        const oldIndex = previousBlocks.findIndex(block => block.id === selected);
        selected = next.blocks[oldIndex]?.id || next.blocks[oldIndex - 1]?.id || null;
      }
      break;
    }
    case 'deleteUnusedAssets': {
      const used = new Set(next.blocks.flatMap(block => [block.assetId, ...(block.assetIds || [])]).filter(Boolean));
      const kept = next.assets.filter(asset => used.has(asset.id));
      if (kept.length === next.assets.length) return { doc, selectedId, changed: false, error: '没有可清理的未使用素材' };
      next.assets = kept;
      break;
    }
    case 'replaceSelectedAsset': {
      if (!selectedId) return { doc, selectedId, changed: false, error: '请先选择文章中的图片' };
      const block = next.blocks.find(item => item.id === selectedId);
      const asset = next.assets.find(item => item.id === intent.assetId);
      if (!block || block.type !== 'image') return { doc, selectedId, changed: false, error: '请先选择文章中的图片' };
      if (!asset) return { doc, selectedId, changed: false, error: '素材不存在' };
      if (block.assetId === asset.id) return { doc, selectedId, changed: false };
      block.assetId = asset.id;
      block.text = asset.alt || asset.name;
      break;
    }
    case 'replaceSelectedAssetByName': {
      if (!selectedId) return { doc, selectedId, changed: false, error: '请先选择文章中的图片' };
      const asset = next.assets.find(item => item.name.toLowerCase().includes(String(intent.name || '').toLowerCase()));
      if (!asset) return { doc, selectedId, changed: false, error: `未找到素材：${intent.name}` };
      const block = next.blocks.find(item => item.id === selectedId);
      if (!block || block.type !== 'image') return { doc, selectedId, changed: false, error: '请先选择文章中的图片' };
      block.assetId = asset.id;
      block.text = asset.alt || asset.name;
      break;
    }
    case 'insertAssetByName': {
      const asset = next.assets.find(a => a.name.toLowerCase().includes(intent.name.toLowerCase()));
      if (!asset) return { doc, selectedId, changed: false, error: `未找到素材：${intent.name}` };
      const block = { id: crypto.randomUUID(), type: 'image', assetId: asset.id, text: asset.alt || asset.name };
      next.blocks.push(block); selected = block.id; break;
    }
    case 'insertAsset': {
      const asset = next.assets.find(a => a.id === intent.assetId);
      if (!asset) return { doc, selectedId, changed: false, error: '素材不存在' };
      const block = { id: crypto.randomUUID(), type: 'image', assetId: asset.id, text: asset.alt || asset.name };
      next.blocks.push(block); selected = block.id; break;
    }
    case 'replaceDocument': {
      const replacement = clone(intent.doc);
      replacement.theme = normalizeTheme(replacement.theme);
      return { doc: replacement, selectedId: replacement.blocks[0]?.id || null, changed: true };
    }
    default: changed = false;
  }
  return { doc: next, selectedId: selected, changed };
}

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function getCoverBlock(doc = {}) {
  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
  const firstImage = blocks.find(block => block.type === 'image');
  return blocks.find(block => block.type === 'image' && block.visualRole === 'cover') || firstImage || null;
}

function getCoverAsset(doc = {}) {
  const block = getCoverBlock(doc);
  return block ? (doc.assets || []).find(asset => asset.id === block.assetId) || null : null;
}

function getCoverCopy(doc = {}, asset = null) {
  return {
    main: String(asset?.coverMain || doc.title || '').trim(),
    sub: String(asset?.coverSub || doc.subtitle || '').trim()
  };
}

export function renderDocumentBody(doc) {
  const assets = doc.assets || [];
  const assetById = id => assets.find(asset => asset.id === id);
  const coverBlock = getCoverBlock(doc);
  const coverAsset = getCoverAsset(doc);
  const coverCopy = getCoverCopy(doc, coverAsset);
  const coverMarkup = coverAsset?.dataUrl
    ? `<figure class="wechat-cover${coverAsset.generated ? ' wechat-cover-generated' : ''}" data-wechat-cover="true"><img src="${escapeHtml(coverAsset.dataUrl)}" alt="${escapeHtml(coverAsset.alt || doc.title || '文章封面')}"><figcaption class="wechat-cover-copy"><strong>${escapeHtml(coverCopy.main)}</strong><span>${escapeHtml(coverCopy.sub)}</span></figcaption></figure>`
    : `<div class="wechat-cover wechat-cover-placeholder" data-wechat-cover="true">封面图片位置 · 请从素材库插入或导入一张封面图</div>`;
  const renderBlock = block => {
    if (coverBlock && block.id === coverBlock.id) return '';
    const text = escapeHtml(block.text || '');
    if (block.type === 'heading') return `<h2>${text}</h2>`;
    if (block.type === 'quote') return `<blockquote>${text}</blockquote>`;
    if (block.type === 'list') {
      const items = (block.items || String(block.text || '').split('\n')).filter(Boolean).map(item => `<li>${escapeHtml(item)}</li>`).join('');
      return block.ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
    }
    if (block.type === 'table') {
      const headers = (block.headers || []).map(item => `<th>${escapeHtml(item)}</th>`).join('');
      const rows = (block.rows || []).map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
      return `<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    if (block.type === 'cta') return `<div class="cta"><p>${text}</p><a href="${escapeHtml(block.href || '#')}">${escapeHtml(block.buttonText || '立即了解')}</a></div>`;
    if (block.type === 'gallery') {
      const images = (block.assetIds || []).map(id => assetById(id)).filter(Boolean).map(asset => `<img src="${escapeHtml(asset.dataUrl)}" alt="${escapeHtml(asset.alt || asset.name)}">`).join('');
      return `<div class="gallery">${images || `<p>${text}</p>`}</div>`;
    }
    if (block.type === 'media') return `<div class="media"><span>${escapeHtml(block.mediaType || 'media')}</span><a href="${escapeHtml(block.url || '#')}">${text || '打开媒体内容'}</a></div>`;
    if (block.type === 'image') {
      const asset = assetById(block.assetId);
      return asset?.dataUrl ? `<figure><img src="${escapeHtml(asset.dataUrl)}" alt="${text}"><figcaption>${text}</figcaption></figure>` : `<div class="missing-image">${text || '图片素材已丢失'}</div>`;
    }
    return `<p>${text}</p>`;
  };
  const summary = `<p class="subtitle wechat-summary" data-wechat-summary="true"><span class="summary-label">内容摘要</span><span class="summary-text">${escapeHtml(doc.subtitle || '')}</span></p>`;
  return `${coverMarkup}<h1>${escapeHtml(doc.title)}</h1><div class="meta">${escapeHtml(doc.author || '公众号排版')} · ${doc.meta?.updatedAt ? new Date(doc.meta.updatedAt).toLocaleDateString() : ''}</div>${summary}${(doc.blocks || []).map(renderBlock).join('')}`;
}

export function renderArticleHtml(doc) {
  const theme = THEMES[normalizeTheme(doc.theme)];
  const styles = {
    article: `max-width:677px;margin:0 auto;padding:28px 20px;background:${theme.surface === '#f5f7f8' ? '#fff' : theme.surface};color:${theme.ink};line-height:1.9;`,
    title: `font-family:${theme.heading};font-size:26px;line-height:1.35;margin:0 0 10px;text-align:center;color:${theme.ink};`,
    subtitle: 'color:#75808b;margin:0 0 6px;text-align:center;',
    meta: 'font-size:12px;color:#a0a8b0;margin-bottom:28px;text-align:center;',
     heading: `font-family:${theme.heading};font-size:20px;margin:28px 0 12px;padding-left:10px;border-left:4px solid ${theme.accent};color:${theme.ink};`,
    paragraph: 'font-size:16px;line-height:1.9;text-align:justify;white-space:pre-wrap;margin:16px 0;',
    quote: `margin:20px 0;padding:13px 15px;background:${theme.surface};border-left:3px solid ${theme.accent};color:#66727c;`,
     imageFigure: 'margin:22px 0;text-align:center;',
     image: 'max-width:100%;display:block;margin:0 auto;border-radius:4px;',
     caption: 'text-align:center;color:#9aa4ad;font-size:12px;margin-top:6px;',
     coverFigure: 'margin:-28px -20px 22px;text-align:center;',
     coverImage: 'width:100%;aspect-ratio:900 / 383;object-fit:cover;display:block;',
     coverCopy: 'padding:8px 12px;background:#f7f8fa;text-align:left;',
     coverMain: `display:block;font-size:16px;font-weight:700;line-height:1.35;color:${theme.ink};`,
     coverSub: 'display:block;margin-top:2px;font-size:12px;line-height:1.45;color:#75808b;',
     summary: `margin:10px 0 22px;padding:10px 12px;background:${theme.surface};border-radius:7px;font-size:13px;line-height:1.65;color:#5f6d7b;`,
     summaryLabel: `display:block;margin-bottom:3px;font-size:11px;font-weight:700;color:${theme.accent};`,
    list: 'padding-left:24px;font-size:16px;line-height:1.9;margin:14px 0;',
    listItem: 'margin:6px 0;line-height:1.75;',
    tableWrap: 'overflow-x:auto;margin:18px 0;',
    table: 'width:100%;border-collapse:collapse;font-size:14px;',
    cell: 'padding:8px;border:1px solid #dfe7ee;text-align:left;',
    headerCell: `padding:8px;border:1px solid #dfe7ee;text-align:left;background:${theme.surface};`,
    cta: `text-align:center;margin:26px 0;padding:20px;background:${theme.surface};border-radius:10px;`,
    ctaLink: `display:inline-block;padding:8px 18px;border-radius:999px;background:${theme.accent};color:#fff;text-decoration:none;`,
    gallery: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:20px 0;',
    galleryImage: 'width:100%;aspect-ratio:1;object-fit:cover;border-radius:4px;',
    media: `display:flex;gap:10px;align-items:center;padding:14px;margin:18px 0;background:${theme.surface};border-radius:8px;`,
    mediaLink: `color:${theme.accent};`,
    missing: 'padding:20px;background:#fff3f3;color:#b42318;'
  };
  const assets = doc.assets || [];
  const assetById = id => assets.find(asset => asset.id === id);
  const coverBlock = getCoverBlock(doc);
  const coverAsset = getCoverAsset(doc);
  const coverCopy = getCoverCopy(doc, coverAsset);
  const coverMarkup = coverAsset?.dataUrl
    ? `<figure style="${styles.coverFigure}" data-wechat-cover="true"><img style="${styles.coverImage}" src="${escapeHtml(coverAsset.dataUrl)}" alt="${escapeHtml(coverAsset.alt || doc.title || '文章封面')}"><figcaption style="${styles.coverCopy}${coverAsset.generated ? 'display:none;' : ''}"><strong style="${styles.coverMain}">${escapeHtml(coverCopy.main)}</strong><span style="${styles.coverSub}">${escapeHtml(coverCopy.sub)}</span></figcaption></figure>`
    : '';
  const renderInlineBlock = block => {
    if (coverBlock && block.id === coverBlock.id) return '';
    const text = escapeHtml(block.text || '');
    if (block.type === 'heading') return `<h2 style="${styles.heading}">${text}</h2>`;
    if (block.type === 'quote') return `<blockquote style="${styles.quote}">${text}</blockquote>`;
    if (block.type === 'list') {
      const items = (block.items || String(block.text || '').split('\\n')).filter(Boolean).map(item => `<li style="${styles.listItem}">${escapeHtml(item)}</li>`).join('');
      return `${block.ordered ? '<ol' : '<ul'} style="${styles.list}">${items}${block.ordered ? '</ol>' : '</ul>'}`;
    }
    if (block.type === 'table') {
      const headers = (block.headers || []).map(item => `<th style="${styles.headerCell}">${escapeHtml(item)}</th>`).join('');
      const rows = (block.rows || []).map(row => `<tr>${row.map(cell => `<td style="${styles.cell}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
      return `<div style="${styles.tableWrap}"><table style="${styles.table}"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    if (block.type === 'cta') return `<div style="${styles.cta}"><p style="${styles.paragraph}">${text}</p><a style="${styles.ctaLink}" href="${escapeHtml(block.href || '#')}">${escapeHtml(block.buttonText || '立即了解')}</a></div>`;
    if (block.type === 'gallery') {
      const images = (block.assetIds || []).map(id => assetById(id)).filter(Boolean).map(asset => `<img style="${styles.galleryImage}" src="${escapeHtml(asset.dataUrl)}" alt="${escapeHtml(asset.alt || asset.name)}">`).join('');
      return `<div style="${styles.gallery}">${images || `<p style="${styles.paragraph}">${text}</p>`}</div>`;
    }
    if (block.type === 'media') return `<div style="${styles.media}"><span>${escapeHtml(block.mediaType || 'media')}</span><a style="${styles.mediaLink}" href="${escapeHtml(block.url || '#')}">${text || '打开媒体内容'}</a></div>`;
    if (block.type === 'image') {
      const asset = assetById(block.assetId);
      return asset?.dataUrl ? `<figure style="${styles.imageFigure}"><img style="${styles.image}" src="${escapeHtml(asset.dataUrl)}" alt="${text}"><figcaption style="${styles.caption}">${text}</figcaption></figure>` : `<div style="${styles.missing}">${text || '图片素材已丢失'}</div>`;
    }
    return `<p style="${styles.paragraph}">${text}</p>`;
  };
  const body = `${coverMarkup}<h1 style="${styles.title}">${escapeHtml(doc.title)}</h1><div style="${styles.meta}">${escapeHtml(doc.author || '公众号排版')} · ${doc.meta?.updatedAt ? new Date(doc.meta.updatedAt).toLocaleDateString() : ''}</div><p style="${styles.summary}" data-wechat-summary="true"><span style="${styles.summaryLabel}">内容摘要</span><span>${escapeHtml(doc.subtitle || '')}</span></p>${(doc.blocks || []).map(renderInlineBlock).join('')}`;
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title><article class="wechat-article" style="${styles.article}">${body}</article>`;
}

export class VersionStore {
  constructor(doc, max = MAX_HISTORY) {
    this.max = max;
    this.history = [{ seq: 1, ts: doc.meta.updatedAt, label: '初始化', doc: clone(doc) }];
    this.future = [];
  }
  commit(doc, label = '编辑') {
    const seq = (this.history.at(-1)?.seq || 0) + 1;
    const snapshot = { seq, ts: new Date().toISOString(), label, doc: clone(stamp(clone(doc), seq)) };
    this.history.push(snapshot);
    if (this.history.length > this.max) this.history.shift();
    this.future = [];
    return clone(snapshot.doc);
  }
  undo(current) {
    if (this.history.length <= 1) return current;
    const popped = this.history.pop();
    this.future.push(popped);
    return clone(this.history.at(-1).doc);
  }
  redo(current) {
    const snapshot = this.future.pop();
    if (!snapshot) return current;
    this.history.push(snapshot);
    return clone(snapshot.doc);
  }
  list() { return this.history.map(({ seq, ts, label }) => ({ seq, ts, label })); }
}
