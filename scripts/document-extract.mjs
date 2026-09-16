import { extname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import TurndownService from 'turndown';

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MARKITDOWN_BRIDGE = fileURLToPath(new URL('./markitdown-bridge.py', import.meta.url));
const MARKITDOWN_OUTPUT_BYTES = 40 * 1024 * 1024;
const MARKITDOWN_TIMEOUT_MS = 30_000;
const markdownConverter = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  linkStyle: 'inlined'
});
markdownConverter.remove(['script', 'style', 'meta', 'link', 'noscript']);

/** Keeps the intermediate article stable before the Draftloom parser consumes it. */
export function normalizeMarkdown(value = '') {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/^\s*[*+](?=\s)/gm, '- ')
    .replace(/^(\s*(?:-|\d+\.)\s)\s+/gm, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Converts Mammoth's semantic HTML fragment to local Markdown. */
export function htmlToMarkdown(value = '') {
  return normalizeMarkdown(markdownConverter.turndown(String(value ?? '')));
}

/** Gives plain-text sources the same normalized Markdown handoff as DOCX/PDF. */
export function textToMarkdown(value = '') {
  return normalizeMarkdown(value);
}

function markItDownMode() {
  const mode = String(process.env.DRAFTLOOM_MARKITDOWN || 'auto').toLowerCase();
  return ['auto', 'off', 'required'].includes(mode) ? mode : 'auto';
}

function markItDownExecutables() {
  const configured = String(process.env.DRAFTLOOM_PYTHON || '').trim();
  return configured ? [configured] : process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
}

/**
 * Uses Microsoft's MarkItDown when available, without making it a hard
 * runtime dependency. The JS converters remain the deterministic fallback.
 */
async function convertWithMarkItDown(buffer, filename) {
  if (markItDownMode() === 'off') return null;
  const errors = [];
  for (const executable of markItDownExecutables()) {
    const result = await new Promise((resolve) => {
      const child = spawn(executable, [MARKITDOWN_BRIDGE], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { ...process.env, DRAFTLOOM_MARKITDOWN_FILENAME: filename },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
      const stdout = [];
      const stderr = [];
      let outputBytes = 0;
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      const timer = setTimeout(() => {
        child.kill();
        finish({ ok: false, unavailable: false, error: 'MarkItDown 本地转换超时' });
      }, MARKITDOWN_TIMEOUT_MS);
      child.stdout.on('data', chunk => {
        outputBytes += chunk.length;
        if (outputBytes <= MARKITDOWN_OUTPUT_BYTES) stdout.push(chunk);
        else {
          child.kill();
          finish({ ok: false, unavailable: false, error: 'MarkItDown 输出超过本地上限' });
        }
      });
      child.stderr.on('data', chunk => stderr.push(chunk));
      child.on('error', error => {
        clearTimeout(timer);
        finish({ ok: false, unavailable: error.code === 'ENOENT', error: error.message });
      });
      child.on('close', code => {
        clearTimeout(timer);
        const message = Buffer.concat(stderr).toString('utf8').trim();
        const markdown = normalizeMarkdown(Buffer.concat(stdout).toString('utf8'));
        finish({ ok: code === 0 && Boolean(markdown), unavailable: false, markdown, error: message || `MarkItDown 退出码 ${code}` });
      });
      child.stdin.end(buffer);
    });
    if (result.ok) return { markdown: result.markdown, converter: 'microsoft-markitdown', warnings: [] };
    if (!result.unavailable) errors.push(`${executable}: ${result.error}`);
  }
  if (markItDownMode() === 'required') throw new Error(`MarkItDown 未能完成本地转换：${errors.join('；') || '未找到 Python 或 markitdown 包'}`);
  return null;
}

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
    const markItDown = await convertWithMarkItDown(buffer, filename);
    if (markItDown) {
      return { kind, filename, format: 'markdown', markdown: markItDown.markdown, text: markItDown.markdown, converter: markItDown.converter, warnings: markItDown.warnings };
    }
    const result = await mammoth.convertToHtml({ buffer });
    const markdown = htmlToMarkdown(result.value || '');
    return {
      kind,
      filename,
      format: 'markdown',
      markdown,
      text: markdown,
      converter: 'mammoth-turndown',
      warnings: (result.messages || []).map(message => message.message || String(message))
    };
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText({ normalizeWhitespace: true });
    const markdown = textToMarkdown(result.text || '');
    return { kind, filename, format: 'markdown', markdown, text: markdown, pages: result.total || 0, converter: 'pdf-parse-markdown', warnings: [] };
  } finally {
    await parser.destroy();
  }
}
