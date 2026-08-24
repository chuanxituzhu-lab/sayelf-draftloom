#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { APP_VERSION } from '../src/version.js';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), 'cli.mjs');const tools = [
  { name: 'publishing_state', description: '读取本地公众号文章状态', inputSchema: { type: 'object', properties: {} } },
  { name: 'publishing_import', description: '导入文章文件和本地图片并自动生成排版结构', inputSchema: { type: 'object', properties: { articlePath: { type: 'string' }, text: { type: 'string' }, images: { type: 'array', items: { type: 'string' } } } } },
  { name: 'publishing_guidance', description: '读取当前文章的人工排版指导建议', inputSchema: { type: 'object', properties: {} } },
  { name: 'publishing_cover', description: '生成公众号头条版/方版封面 SVG 候选，并返回文案与尺寸检查结果；最终封面由人工确认', inputSchema: { type: 'object', properties: { title: { type: 'string' }, formula: { type: 'string', enum: ['number', 'painpoint', 'counter', 'suspense'] }, out: { type: 'string' }, main: { type: 'string' }, sub: { type: 'string' }, audit: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, bg: { type: 'string' }, fg: { type: 'string' }, accent: { type: 'string' } } } },
  { name: 'publishing_cover_set', description: '根据封面与内容摘要设置区优先复用素材库中的合规封面，缺少时生成可替换候选，并同步摘要', inputSchema: { type: 'object', properties: {} } },
  { name: 'publishing_visual_compose', description: '根据文章内容总结摘要、生成爆款标题候选，并把素材或本地创意图自动入库后智能插入章节；结果仍可人工替换、移动或删除', inputSchema: { type: 'object', properties: { generate: { type: 'boolean', default: true }, maxGenerated: { type: 'number', default: 3 }, forceTitle: { type: 'boolean', default: false }, fillUnmatched: { type: 'boolean', default: false, description: '将未语义匹配的素材库图片按章节顺序自动填充' } } } },
  { name: 'publishing_wechat_check', description: '一键检查微信公众号字段、正文、封面与排版建议；先自动修正可安全修正项，再返回仍需人工处理的问题', inputSchema: { type: 'object', properties: {} } },
  { name: 'publishing_optimize_wechat', description: '按微信公众号发布约束自动修正标题、作者、摘要和封面文案；正文超限时生成系列拆分建议，不静默删除原文', inputSchema: { type: 'object', properties: {} } },
  { name: 'publishing_growth_analyze', description: '根据公众号创作画像分析当前文章的合规状态、增长信号和人工修改建议；增长分数只作建议，不触发发布', inputSchema: { type: 'object', properties: { profile: { type: 'object' } } } },
  { name: 'publishing_growth_brief', description: '根据公众号创作画像生成当前文章的选题方向、标题建议、结构和 CTA，供人工或 Agent 编辑', inputSchema: { type: 'object', properties: { profile: { type: 'object' } } } },
  { name: 'publishing_draft_status', description: '检查微信公众号草稿箱授权配置状态，不泄露凭据', inputSchema: { type: 'object', properties: {} } },
  { name: 'publishing_draft_submit', description: '经显式确认后提交当前文章到微信公众号草稿箱；未配置凭据时只生成本地草稿包', inputSchema: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'boolean' }, out: { type: 'string' } } } },
  { name: 'publishing_apply_text', description: '应用中文自然语言排版指令', inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } } },
  { name: 'publishing_humanize', description: '以自然化或保守模式处理文章文字，保留原稿以便回滚', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['natural', 'conservative'] } } } },
  { name: 'publishing_apply_intent', description: '应用结构化公众号排版 Intent', inputSchema: { type: 'object', required: ['intent'], properties: { intent: { type: 'object' } } } },
  { name: 'publishing_export', description: '导出公众号 HTML', inputSchema: { type: 'object', required: ['out'], properties: { out: { type: 'string' } } } },
  { name: 'publishing_publish', description: '仅生成本地微信兼容 HTML、草稿 payload 与 manifest，不产生远程副作用', inputSchema: { type: 'object', properties: { out: { type: 'string' } } } }
];
const response = (id, value) => ({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] } });
const failure = (id, message) => ({ jsonrpc: '2.0', id, error: { code: -32000, message } });function callTool(name, input) {
  const dataArgs = process.env.WECHAT_LAYOUT_DATA ? ['--data', process.env.WECHAT_LAYOUT_DATA] : [];
  if (name === 'publishing_state') return JSON.parse(execFileSync(process.execPath, [cli, 'state', ...dataArgs], { encoding: 'utf8' }));
  if (name === 'publishing_import') {
    const args = [cli, 'import', ...dataArgs];
    if (input.articlePath) args.push('--article', input.articlePath);
    if (input.text !== undefined) args.push('--text', input.text);
    for (const image of input.images || []) args.push('--image', image);
    return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  }
  if (name === 'publishing_guidance') return JSON.parse(execFileSync(process.execPath, [cli, 'guidance', ...dataArgs], { encoding: 'utf8' }));
  if (name === 'publishing_visual_compose') {
    const args = [cli, input.fillUnmatched === true ? 'assets-fill' : 'visuals', '--generate', input.generate === false ? 'false' : 'true', '--max-generated', String(input.maxGenerated ?? 3), '--force-title', input.forceTitle === true ? 'true' : 'false', ...dataArgs];
    return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  }
  if (name === 'publishing_cover_set') return JSON.parse(execFileSync(process.execPath, [cli, 'cover-set', ...dataArgs], { encoding: 'utf8' }));
  if (name === 'publishing_wechat_check') return JSON.parse(execFileSync(process.execPath, [cli, 'wechat-check', ...dataArgs], { encoding: 'utf8' }));
  if (name === 'publishing_optimize_wechat') return JSON.parse(execFileSync(process.execPath, [cli, 'wechat-optimize', ...dataArgs], { encoding: 'utf8' }));
  if (name === 'publishing_cover') {
    const args = [cli, 'cover', ...dataArgs];
    const options = ['title', 'formula', 'out', 'main', 'sub', 'audit', 'width', 'height', 'bg', 'fg', 'accent'];
    for (const key of options) {
      if (input[key] === undefined || input[key] === null || input[key] === '') continue;
      args.push(`--${key}`, String(input[key]));
    }
    return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  }
  if (name === 'publishing_growth_analyze' || name === 'publishing_growth_brief') {
    const args = [cli, name.endsWith('brief') ? 'growth-brief' : 'growth', ...dataArgs];
    if (input.profile) args.push('--profile-json', JSON.stringify(input.profile));
    return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  }
  if (name === 'publishing_draft_status') return JSON.parse(execFileSync(process.execPath, [cli, 'draft-status', ...dataArgs], { encoding: 'utf8' }));
  if (name === 'publishing_draft_submit') {
    const args = [cli, 'draft-submit', '--confirm', input.confirm === true ? 'true' : 'false', ...dataArgs];
    if (input.out) args.push('--out', input.out);
    return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  }
  if (name === 'publishing_apply_text') return JSON.parse(execFileSync(process.execPath, [cli, 'text', '--text', input.text, ...dataArgs], { encoding: 'utf8' }));
  if (name === 'publishing_humanize') return JSON.parse(execFileSync(process.execPath, [cli, 'humanize', '--mode', input.mode === 'conservative' ? 'conservative' : 'natural', ...dataArgs], { encoding: 'utf8' }));
  if (name === 'publishing_apply_intent') return JSON.parse(execFileSync(process.execPath, [cli, 'intent', '--json', JSON.stringify(input.intent), ...dataArgs], { encoding: 'utf8' }));
  if (name === 'publishing_export') return JSON.parse(execFileSync(process.execPath, [cli, 'export', '--out', input.out, ...dataArgs], { encoding: 'utf8' }));
  if (name === 'publishing_publish') {
    const args = [cli, 'publish', ...dataArgs];
    if (input.out) args.push('--out', input.out);
    return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  }
  throw new Error(`Unknown tool: ${name}`);
}
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  if (!line.trim()) return;
  let request; try { request = JSON.parse(line); } catch { process.stdout.write(JSON.stringify(failure(null, 'Invalid JSON')) + '\n'); return; }
  if (request.method === 'notifications/initialized') return;
  if (request.method === 'initialize') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'wechat-layout-mvp', version: APP_VERSION } } }) + '\n'); return; }
  if (request.method === 'tools/list') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools } }) + '\n'); return; }
  if (request.method === 'tools/call') { try { process.stdout.write(JSON.stringify(response(request.id, callTool(request.params?.name, request.params?.arguments || {}))) + '\n'); } catch (error) { process.stdout.write(JSON.stringify(failure(request.id, error.message)) + '\n'); } return; }
  if (request.id !== undefined) process.stdout.write(JSON.stringify(failure(request.id, `Method not found: ${request.method}`)) + '\n');
});