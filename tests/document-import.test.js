import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getArticleFileKind, sanitizeArticleText, sanitizeImportedDocument } from '../src/document-import.js';
import { importArticle, renderArticleHtml } from '../src/core.js';
import { detectArticleEmphasis } from '../src/document-import.js';
import { documentKind, extractLocalDocument, htmlToMarkdown, normalizeMarkdown, textToMarkdown } from '../scripts/document-extract.mjs';
import { MAX_ARTICLE_HISTORY, createArticleHistoryEntry, restoreArticleHistoryEntry, upsertArticleHistory } from '../src/article-history.js';

function makePdf(text) {
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${text.replace(/[()\\]/g, '\\$&')}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

test('article file detection accepts text, DOCX, and PDF', () => {
  assert.equal(getArticleFileKind({ name: '稿件.docx', type: '' }), 'docx');
  assert.equal(getArticleFileKind({ name: '稿件.pdf', type: 'application/octet-stream' }), 'pdf');
  assert.equal(getArticleFileKind({ name: '稿件.txt', type: 'text/plain' }), 'text');
  assert.equal(documentKind('稿件.docx', ''), 'docx');
  assert.equal(documentKind('稿件.pdf', 'application/pdf'), 'pdf');
});

test('sanitizeArticleText removes Markdown markers while retaining article text', () => {
  const value = sanitizeArticleText('# 标题\n\n**重点**：`内容`\n> 引用\n---\n- 列表');
  assert.equal(value, '标题\n\n重点：内容\n引用\n列表');
});

test('local document conversion produces a Markdown intermediate without network access', () => {
  const markdown = htmlToMarkdown('<h1>文章标题</h1><p>正文 <strong>重点</strong>。</p><h2>执行步骤</h2><ol><li>先准备素材</li><li>再进行排版</li></ol>');
  assert.match(markdown, /^# 文章标题/m);
  assert.match(markdown, /\*\*重点\*\*/);
  assert.match(markdown, /^## 执行步骤/m);
  assert.match(markdown, /1\. 先准备素材/);
  assert.equal(normalizeMarkdown('  一段文字。\r\n\r\n\r\n'), '一段文字。');
  assert.equal(textToMarkdown('纯文本\r\n\r\n第二段'), '纯文本\n\n第二段');
});

test('DOCX extraction keeps Word list structure in the Markdown handoff', async () => {
  const buffer = await readFile(new URL('../node_modules/mammoth/test/test-data/simple-list.docx', import.meta.url));
  const result = await extractLocalDocument({ buffer, filename: 'simple-list.docx' });
  assert.equal(result.kind, 'docx');
  assert.equal(result.format, 'markdown');
  assert.match(result.markdown, /Apple/);
  assert.match(result.markdown, /Banana/);
  assert.match(result.markdown, /-\s+Apple/);
});

test('sanitizeImportedDocument keeps original source and cleans document fields', () => {
  const source = '# 原始标题\n\n**正文**';
  const document = {
    title: '# 原始标题',
    author: '*作者*',
    subtitle: '**摘要**',
    blocks: [{ id: 'p1', type: 'paragraph', text: '**正文**' }],
    original: { text: source },
    meta: { titlePlan: { selected: '**候选**', candidates: [{ title: '# 候选' }] } }
  };
  const cleaned = sanitizeImportedDocument(document);
  assert.equal(cleaned.title, '原始标题');
  assert.equal(cleaned.author, '作者');
  assert.equal(cleaned.subtitle, '摘要');
  assert.equal(cleaned.blocks[0].text, '正文');
  assert.equal(cleaned.meta.titlePlan.selected, '候选');
  assert.equal(cleaned.meta.titlePlan.candidates[0].title, '候选');
  assert.equal(cleaned.original.text, source);
  assert.equal(document.blocks[0].text, '**正文**');
});

test('importArticle keeps markers out of visible composed content while preserving the source', () => {
  const source = '# 原始标题\n\n**正文**：`本地处理`';
  const imported = importArticle({ text: source, filename: '稿件.md', autoCompose: true });
  const visible = [
    imported.title,
    imported.author,
    imported.subtitle,
    ...imported.blocks.map(block => block.text || ''),
    imported.meta.visualPlan?.title?.selected || ''
  ].join('\n');
  assert.doesNotMatch(visible, /[*#`]/);
  assert.equal(imported.original.text, source);
});

test('article emphasis detects important and numbered sections and renders a color block', () => {
  assert.equal(detectArticleEmphasis('重点：先做最重要的事情').label, '重点');
  assert.equal(detectArticleEmphasis('第3章：执行').label, '章节');
  assert.equal(detectArticleEmphasis('一~N：持续迭代').label, '范围');
  assert.equal(detectArticleEmphasis('01 自媒体的本质').label, '编号');
  assert.equal(detectArticleEmphasis('上一段结论。02 创作不是闭门造车').label, '编号');
  assert.equal(detectArticleEmphasis('上一段结论。重点：先做最重要的事情').label, '重点');
  assert.equal(detectArticleEmphasis('一个章节标题', { type: 'heading' }).label, '标题');
  assert.equal(detectArticleEmphasis('普通正文段落'), null);
  const document = importArticle({ text: '标题\n\n重点：先做最重要的事情\n\n普通正文段落' });
  assert.equal(document.blocks[0].emphasis, 'inline');
  assert.ok(document.blocks[0].emphasisRanges[0].end < document.blocks[0].text.length);
  assert.equal(document.blocks[1].emphasis, undefined);
  assert.match(renderArticleHtml(document), /<mark style="background:#fff1cf/);
  assert.doesNotMatch(renderArticleHtml(document), /font-weight:700;color:#17212b;background:#fff7e8/);
});

test('extractLocalDocument extracts text from a local PDF buffer', async () => {
  const result = await extractLocalDocument({
    buffer: makePdf('Local PDF * # text'),
    filename: 'sample.pdf',
    contentType: 'application/pdf'
  });
  assert.equal(result.kind, 'pdf');
  assert.equal(result.format, 'markdown');
  assert.equal(result.markdown, result.text);
  assert.equal(result.pages, 1);
  assert.match(result.text, /Local PDF/);
});

test('article history preserves multiple article structures without duplicating image data', () => {
  const first = { id: 'a1', title: '第一篇', blocks: [{ type: 'paragraph', text: '第一篇正文' }], assets: [{ id: 'img1', dataUrl: 'data:image/png;base64,large' }], original: { filename: 'first.docx', text: '第一篇正文' } };
  const second = { id: 'a2', title: '第二篇', blocks: [{ type: 'paragraph', text: '第二篇正文' }], assets: [], original: { filename: 'second.pdf', text: '第二篇正文' } };
  const entries = upsertArticleHistory(upsertArticleHistory([], first, '2026-08-29T00:00:00.000Z'), second, '2026-08-29T01:00:00.000Z');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, '第二篇');
  assert.equal(entries[1].doc.assets[0].dataUrl, undefined);
  const restored = restoreArticleHistoryEntry(entries[1], [{ id: 'img1', dataUrl: 'data:image/png;base64,restored' }]);
  assert.equal(restored.assets[0].dataUrl, 'data:image/png;base64,restored');
  assert.equal(MAX_ARTICLE_HISTORY, 12);
  const manyEntries = Array.from({ length: MAX_ARTICLE_HISTORY + 2 }, (_, index) => ({
    id: `article-${index}`,
    title: `文章 ${index}`,
    blocks: [{ type: 'paragraph', text: `正文 ${index}` }],
    assets: [],
    original: { filename: `${index}.txt`, text: `正文 ${index}` }
  })).reduce((result, item) => upsertArticleHistory(result, item), []);
  assert.equal(manyEntries.length, MAX_ARTICLE_HISTORY);
  assert.equal(createArticleHistoryEntry({ blocks: [], original: null }), null);
});
