export const MAX_ARTICLE_HISTORY = 12;

function clone(value) {
  return structuredClone(value);
}

export function hasArticleContent(document = {}) {
  const source = String(document.original?.text || '').trim();
  if (!source && String(document.title || '').trim() === '未命名公众号文章') return false;
  const blocks = Array.isArray(document.blocks) ? document.blocks : [];
  const hasTextBlock = blocks.some(block => block?.type !== 'image' && String(block?.text || '').trim());
  return Boolean(source || hasTextBlock);
}

/** Store article structure and references, but keep large image data in the shared local asset library. */
export function createArticleHistoryEntry(document = {}, savedAt = new Date().toISOString()) {
  if (!hasArticleContent(document)) return null;
  const snapshot = clone(document);
  snapshot.assets = (snapshot.assets || []).map(asset => {
    const { dataUrl, ...metadata } = asset;
    return metadata;
  });
  return {
    id: String(snapshot.id || `${savedAt}:${snapshot.title || 'article'}`),
    title: String(snapshot.title || '未命名文章').trim() || '未命名文章',
    filename: String(snapshot.original?.filename || '本地文章'),
    savedAt,
    doc: snapshot
  };
}

export function upsertArticleHistory(entries = [], document = {}, savedAt = new Date().toISOString()) {
  const entry = createArticleHistoryEntry(document, savedAt);
  if (!entry) return Array.isArray(entries) ? entries : [];
  const existing = Array.isArray(entries) ? entries : [];
  return [entry, ...existing.filter(item => item?.id !== entry.id)].slice(0, MAX_ARTICLE_HISTORY);
}

export function removeArticleHistoryEntry(entries = [], id = '') {
  return (Array.isArray(entries) ? entries : []).filter(item => item?.id !== id);
}

/** Reconnect an archived article to the current shared local asset library. */
export function restoreArticleHistoryEntry(entry, assets = []) {
  if (!entry?.doc) return null;
  const next = clone(entry.doc);
  const byId = new Map();
  for (const asset of Array.isArray(assets) ? assets : []) if (asset?.id && asset?.dataUrl) byId.set(asset.id, asset);
  for (const asset of Array.isArray(next.assets) ? next.assets : []) if (asset?.id && !byId.has(asset.id)) byId.set(asset.id, asset);
  next.assets = [...byId.values()];
  return next;
}
