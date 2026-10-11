import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LIBRARY_DIR = 'article-library';

function stableId(mediaId, articleIndex = 0) {
  return createHash('sha256').update(`${String(mediaId)}:${Number(articleIndex) || 0}`).digest('hex');
}

function textFromHtml(html = '') {
  return String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|section|tr)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function localArticleText(doc = {}, contentHtml = '') {
  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
  const fromBlocks = blocks.filter(block => block?.type !== 'image')
    .map(block => String(block?.text || '').trim()).filter(Boolean).join('\n\n');
  return [String(doc.original?.text || '').trim(), fromBlocks, textFromHtml(contentHtml)]
    .filter(Boolean).join('\n\n').slice(0, 2_000_000);
}

async function ensureDir(root) {
  const dir = join(root, '.local-data', LIBRARY_DIR);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function readEntry(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`本地文章库记录无法读取：${error.message}`);
  }
}

async function appendEntry(root, entry) {
  const dir = await ensureDir(root);
  const path = join(dir, `${entry.id}.json`);
  const existing = await readEntry(path);
  if (existing) return { entry: existing, created: false };
  const temp = join(dir, `.${entry.id}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(entry), { encoding: 'utf8', flag: 'wx' });
    try { await link(temp, path); }
    catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
      const raced = await readEntry(path);
      if (!raced) throw error;
      return { entry: raced, created: false };
    }
  } finally { await rm(temp, { force: true }); }
  return { entry, created: true };
}

/** Persist only confirmed WeChat draft receipts. Files are local, append-only, and excluded from Git. */
export async function archiveSubmittedArticle(root, doc, delivery, savedAt = new Date().toISOString(), submittedHtml = '') {
  if (delivery?.status !== 'submitted' || !delivery?.draftId) throw new Error('只有收到微信草稿成功回执后才能归档');
  const mediaId = String(delivery.draftId).trim();
  const id = stableId(mediaId, 0);
  const entry = {
    id,
    draftId: mediaId,
    articleIndex: 0,
    source: 'submitted-here',
    savedAt,
    title: String(doc?.title || '').trim() || '未命名文章',
    digest: String(doc?.subtitle || '').trim(),
    text: localArticleText(doc, submittedHtml),
    submittedHtml: String(submittedHtml || ''),
    doc: structuredClone(doc)
  };
  const result = await appendEntry(root, entry);
  return { id, draftId: mediaId, title: result.entry.title, savedAt: result.entry.savedAt, created: result.created };
}

/** Import a read-only WeChat draft page; the stable media-id/index key makes sync idempotent. */
export async function archiveSyncedDraft(root, item, article, articleIndex = 0, savedAt = new Date().toISOString()) {
  const mediaId = String(item?.media_id || '').trim();
  if (!mediaId || !article || typeof article !== 'object') return null;
  const id = stableId(mediaId, articleIndex);
  const contentHtml = String(article.content || '');
  const entry = {
    id,
    draftId: mediaId,
    articleIndex,
    source: 'synced-from-wechat',
    savedAt,
    remoteUpdateTime: Number(item.update_time || 0) || null,
    title: String(article.title || '').trim() || '未命名公众号草稿',
    digest: String(article.digest || '').trim(),
    author: String(article.author || '').trim(),
    contentHtml,
    text: localArticleText({}, contentHtml)
  };
  const result = await appendEntry(root, entry);
  return { id, draftId: mediaId, title: result.entry.title, savedAt: result.entry.savedAt, created: result.created };
}

export async function listArticleLibrary(root, query = '') {
  const dir = await ensureDir(root);
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
  const entries = [];
  for (const name of await readdir(dir)) {
    if (!/^[a-f0-9]{64}\.json$/i.test(name)) continue;
    const entry = await readEntry(join(dir, name));
    if (!entry) continue;
    if (normalizedQuery && !`${entry.title} ${entry.digest} ${entry.text}`.toLocaleLowerCase().includes(normalizedQuery)) continue;
    entries.push({
      id: entry.id, draftId: entry.draftId, articleIndex: entry.articleIndex,
      source: entry.source, savedAt: entry.savedAt, remoteUpdateTime: entry.remoteUpdateTime || null,
      title: entry.title, digest: entry.digest, excerpt: entry.text.slice(0, 180), hasDocument: Boolean(entry.doc)
    });
  }
  return entries.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

export async function getArticleLibraryEntry(root, id) {
  if (!/^[a-f0-9]{64}$/i.test(String(id || ''))) return null;
  return readEntry(join(await ensureDir(root), `${id}.json`));
}

export async function deleteArticleLibraryEntry(root, id) {
  if (!/^[a-f0-9]{64}$/i.test(String(id || ''))) return false;
  const path = join(await ensureDir(root), `${id}.json`);
  const existing = await readEntry(path);
  if (!existing) return false;
  await rm(path);
  return true;
}

export function articleTextFromHtml(html) { return textFromHtml(html); }
