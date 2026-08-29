import { extname } from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function documentKind(filename = '', contentType = '') {
  const extension = extname(String(filename)).toLowerCase();
  const type = String(contentType || '').toLowerCase();
  if (extension === '.docx' || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (extension === '.pdf' || type === 'application/pdf') return 'pdf';
  return null;
}
export async function extractLocalDocument({ buffer, filename = 'document', contentType = '' } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error('文档内容不是有效的本地二进制数据');
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error(`文档超过本地导入上限（${MAX_DOCUMENT_BYTES / 1024 / 1024}MB）`);
  const kind = documentKind(filename, contentType);
  if (!kind) throw new Error('仅支持 DOCX 或 PDF 文档');

  if (kind === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    return {
      kind,
      filename,
      text: result.value || '',
      warnings: (result.messages || []).map(message => message.message || String(message))
    };
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText({ normalizeWhitespace: true });
    return { kind, filename, text: result.text || '', pages: result.total || 0, warnings: [] };
  } finally {
    await parser.destroy();
  }
}
