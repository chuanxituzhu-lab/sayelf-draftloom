// src/cover.js —— 公众号封面模块（零依赖、纯函数、可测）
import { WECHAT_LIMITS, inspectWechatCover } from './wechat-limits.js';
// 依据微信官方规范 + 爆款封面公开规则蒸馏，不调外部 AI，确定性生成。
//
// 尺寸规范（developers.weixin.qq.com 及 2025 运营规范核对）：
//   头条封面  2.35:1  900×383（比例正好则不裁剪）
//   分享小图  1:1     383×383（历史/转发缩略图，取头图中央方形区域）
//   宽度 ≤1280px 否则被压缩掉画质；文件 ≤10MB，建议 <1MB
//   关键文字/logo 必须居中——两侧在缩略图场景会被裁掉

export const COVER_SPEC = Object.freeze({ ...WECHAT_LIMITS.titleImage });

// ── 爆款文案规则引擎 ────────────────────────────────────────────
// 四大公开公式（新榜/知乎/壹伴等交叉验证）：
//   ① 数字型：数字 + 价值点 + 精准人群
//   ② 痛点型：痛点描述 + 方法 + 效果保证
//   ③ 反认知：常识/热点 + 颠覆结论
//   ④ 悬念型：反常现象 + 有限提示
export const HEADLINE_FORMULAS = Object.freeze(['number', 'painpoint', 'counter', 'suspense']);

// 需求词（含之点击率更高，来自公开数据）
const DEMAND_WORDS = ['技巧', '攻略', '方法', '清单', '指南', '真相', '秘诀'];
const NUM_RE = /(\d+)/;

// 从标题/正文里抽取可用信号：数字、人群词、痛点词
function extractSignals(title = '', body = '') {
  const text = `${title} ${body}`;
  const number = (title.match(NUM_RE) || body.match(NUM_RE) || [])[1] || null;
  const audience = (text.match(/(职场|新手|小白|运营|老板|宝妈|学生|打工人|创业者|程序员)/) || [])[1] || null;
  const hasDemandWord = DEMAND_WORDS.some(w => text.includes(w));
  return { number, audience, hasDemandWord };
}

// 生成封面主文案（大字，建议 ≤10 字，居中）+ 副文案（可选一行）
// 返回多个候选，供人工在审核阶段挑选（不替人做最终决定）
export function draftCoverCopy({ title = '', body = '', formula = null } = {}) {
  const t = String(title).trim();
  const sig = extractSignals(t, body);
  const clip = (s, n) => [...String(s)].slice(0, n).join('');
  const candidates = [];

  // 主文案：优先保留标题里的“钩子”，压到 ≤10 字
  const core = clip(t.replace(/[《》「」【】]/g, '').split(/[，,。！!？?：:—-]/)[0], WECHAT_LIMITS.titleImage.mainChars) || clip(t, WECHAT_LIMITS.titleImage.mainChars);

  const pick = formula && HEADLINE_FORMULAS.includes(formula) ? [formula] : HEADLINE_FORMULAS;
  for (const f of pick) {
    if (f === 'number' && sig.number) {
      candidates.push({ formula: 'number', main: core, sub: clip(`${sig.number}个关键点${sig.audience ? '·' + sig.audience : ''}`, WECHAT_LIMITS.titleImage.subChars) });
    } else if (f === 'painpoint') {
      candidates.push({ formula: 'painpoint', main: core, sub: clip(sig.audience ? `${sig.audience}必看的解法` : '一次讲清怎么做', WECHAT_LIMITS.titleImage.subChars) });
    } else if (f === 'counter') {
      candidates.push({ formula: 'counter', main: core, sub: clip('可能你一直想错了', WECHAT_LIMITS.titleImage.subChars) });
    } else if (f === 'suspense') {
      candidates.push({ formula: 'suspense', main: core, sub: clip('看完你就懂了', WECHAT_LIMITS.titleImage.subChars) });
    }
  }
  if (!candidates.length) candidates.push({ formula: 'plain', main: core, sub: '' });

  // 规则体检：给人工审核用的可操作提示，不自动改写
  const checks = [];
  if ([...core].length > WECHAT_LIMITS.titleImage.mainChars) checks.push(`主文案超 ${WECHAT_LIMITS.titleImage.mainChars} 字，封面上可能显示拥挤，建议再压缩`);
  if (!sig.number) checks.push('无数字：数字型封面点击率更高，可在正文提炼一个关键数字');
  if (!sig.hasDemandWord) checks.push('无“技巧/攻略/清单”等需求词，含之搜索与点击通常更好');
  if (!sig.audience) checks.push('未点明人群：加“职场/新手/运营”等精准人群更易触达');

  return { candidates, signals: sig, checks, note: '文案为规则引擎草拟的候选，请人工在审核阶段选定/微调后再用' };
}

// ── SVG 封面生成（900×383 与 383×383）────────────────────────────
function esc(s = '') {
  return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 生成一张符合尺寸规范的 SVG 封面。文字居中、落在安全区内。
// opts: { main, sub, bg, fg, accent, kind:'headline'|'square' }
export function renderCoverSvg({ main = '', sub = '', bg = '#0f172a', fg = '#ffffff', accent = '#22c55e', kind = 'headline' } = {}) {
  const spec = kind === 'square' ? COVER_SPEC.square : COVER_SPEC.headline;
  const { w, h } = spec;
  const cx = w / 2;
  // 主字号按字数自适应，保证不溢出安全区（中央 383 宽）
  const n = Math.max([...main].length, 1);
  const mainSize = Math.max(28, Math.min(kind === 'square' ? 64 : 72, Math.floor((COVER_SPEC.safeCenterWidth - 40) / n * 1.6)));
  const subSize = Math.max(16, Math.floor(mainSize * 0.34));
  const mainY = sub ? h / 2 - mainSize * 0.15 : h / 2 + mainSize * 0.35;
  const subY = mainY + mainSize * 0.75;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${esc(bg)}"/>
  <rect x="0" y="${h - 8}" width="${w}" height="8" fill="${esc(accent)}"/>
  <line x1="${cx}" y1="24" x2="${cx}" y2="${h - 24}" stroke="${esc(accent)}" stroke-opacity="0.0"/>
  <text x="${cx}" y="${mainY}" fill="${esc(fg)}" font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="${mainSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${esc(main)}</text>
  ${sub ? `<text x="${cx}" y="${subY}" fill="${esc(accent)}" font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="${subSize}" font-weight="500" text-anchor="middle" dominant-baseline="middle">${esc(sub)}</text>` : ''}
</svg>`;
}

// 尺寸/大小体检：对“用户自带的封面图”做规范校验，返回可操作结论
// input: { width, height, bytes }
export function auditCoverImage({ width = 0, height = 0, bytes = 0 } = {}) {
  const ratio = width && height ? width / height : 0;
  const kind = Math.abs(ratio - 1) < 0.03 ? 'square' : 'headline';
  const validation = inspectWechatCover({ width, height, bytes, kind });
  const issues = [...validation.errors, ...validation.warnings];
  if (width > COVER_SPEC.maxWidthPx && !issues.some(item => item.includes('建议缩到'))) issues.push(`建议缩到 ≤1080px，避免微信压缩掉画质`);
  return { ratio: validation.ratio, ok: issues.length === 0, issues, warnings: validation.warnings };
}
