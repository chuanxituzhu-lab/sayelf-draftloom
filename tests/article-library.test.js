import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveSubmittedArticle, archiveSyncedDraft, deleteArticleLibraryEntry, getArticleLibraryEntry, listArticleLibrary } from '../src/article-library.js';

test('只归档有微信成功回执的文章，重复 media_id 不覆盖原稿并可检索删除', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftloom-article-library-'));
  try {
    const doc = { id: 'doc-1', title: '本机文章', subtitle: '本地摘要', original: { text: '原稿正文' }, blocks: [{ id: 'p1', type: 'paragraph', text: '正文结论' }], assets: [] };
    await assert.rejects(archiveSubmittedArticle(root, doc, { status: 'ready', draftId: 'not-submitted' }), /只有收到微信草稿成功回执/);
    const created = await archiveSubmittedArticle(root, doc, { status: 'submitted', draftId: 'media-1' }, '2026-10-11T00:00:00.000Z', '<p>实际提交正文</p>');
    assert.equal(created.created, true);
    const changed = { ...doc, title: '不应覆盖的后续标题' };
    const duplicate = await archiveSubmittedArticle(root, changed, { status: 'submitted', draftId: 'media-1' }, '2026-10-12T00:00:00.000Z');
    assert.equal(duplicate.created, false);
    const entry = await getArticleLibraryEntry(root, created.id);
    assert.equal(entry.title, '本机文章');
    assert.match(entry.text, /实际提交正文/);
    assert.equal(entry.submittedHtml, '<p>实际提交正文</p>');
    assert.equal((await listArticleLibrary(root, '结论')).length, 1);
    assert.equal(await deleteArticleLibraryEntry(root, created.id), true);
    assert.equal(await getArticleLibraryEntry(root, created.id), null);
    assert.equal((await readdir(join(root, '.local-data', 'article-library'))).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('历史公众号草稿按 media_id 和图文序号幂等归档且能从 HTML 提取可检索正文', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftloom-wechat-sync-'));
  try {
    const item = { media_id: 'remote-media', update_time: 123 };
    const article = { title: '历史标题', digest: '一句摘要', content: '<section><h2>核心观点</h2><p>这是可检索的正文。</p></section>' };
    const first = await archiveSyncedDraft(root, item, article, 0);
    const duplicate = await archiveSyncedDraft(root, item, { ...article, title: '已不再覆盖' }, 0);
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    const entries = await listArticleLibrary(root, '可检索');
    assert.equal(entries.length, 1);
    const detail = await getArticleLibraryEntry(root, first.id);
    assert.equal(detail.title, '历史标题');
    assert.match(detail.contentHtml, /核心观点/);
    assert.match(detail.text, /这是可检索的正文/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('并发重复归档采用原子新建，不会覆盖先写入的文章', async () => {
  const root = await mkdtemp(join(tmpdir(), 'draftloom-article-library-race-'));
  try {
    const receipt = { status: 'submitted', draftId: 'same-media-id' };
    const firstDoc = { title: '并发版本甲', blocks: [{ type: 'paragraph', text: '正文甲' }] };
    const secondDoc = { title: '并发版本乙', blocks: [{ type: 'paragraph', text: '正文乙' }] };
    const [first, second] = await Promise.all([
      archiveSubmittedArticle(root, firstDoc, receipt),
      archiveSubmittedArticle(root, secondDoc, receipt)
    ]);
    assert.equal([first, second].filter(result => result.created).length, 1);
    const entry = await getArticleLibraryEntry(root, first.id);
    assert.ok(['并发版本甲', '并发版本乙'].includes(entry.title));
    assert.equal((await listArticleLibrary(root)).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
