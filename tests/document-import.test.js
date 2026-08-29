import test from 'node:test';
import assert from 'node:assert/strict';
import { getArticleFileKind, sanitizeArticleText, sanitizeImportedDocument } from '../src/document-import.js';
import { importArticle } from '../src/core.js';
import { documentKind, extractLocalDocument } from '../scripts/document-extract.mjs';

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

test('extractLocalDocument extracts text from a local PDF buffer', async () => {
  const result = await extractLocalDocument({
    buffer: makePdf('Local PDF * # text'),
    filename: 'sample.pdf',
    contentType: 'application/pdf'
  });
  assert.equal(result.kind, 'pdf');
  assert.equal(result.pages, 1);
  assert.match(result.text, /Local PDF/);
});
