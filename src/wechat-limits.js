/**
 * Conservative limits used by the WeChat Official Account draft/add flow.
 *
 * Keep this module browser-safe: the GUI and the Node CLI must report the
 * same values before a draft is sent.  WeChat counts Unicode characters, not
 * JavaScript UTF-16 code units, so charCount uses code points.
 */
const TITLE_IMAGE_LIMITS = Object.freeze({
  headline: Object.freeze({ w: 900, h: 383, ratio: '2.35:1', use: '头条/推送/被推荐展示' }),
  square: Object.freeze({ w: 383, h: 383, ratio: '1:1', use: '主页/转发朋友圈/聊天缩略图' }),
  maxWidthPx: 1280,
  maxBytes: 10 * 1024 * 1024,
  recommendMaxBytes: 1024 * 1024,
  safeCenterWidth: 383,
  mainChars: 10,
  subChars: 14,
  acceptedTypes: Object.freeze(['image/png', 'image/jpeg', 'image/jpg'])
});

export const WECHAT_LIMITS = Object.freeze({
  titleChars: 32,
  authorChars: 16,
  digestChars: 128,
  contentChars: 20_000,
  contentBytes: 1024 * 1024,
  sourceUrlBytes: 1024,
  imageBytes: 10 * 1024 * 1024,
  titleImage: TITLE_IMAGE_LIMITS
});

export function charCount(value = '') {
  return [...String(value ?? '')].length;
}

export function byteCount(value = '') {
  const text = String(value ?? '');
  if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') return Buffer.byteLength(text, 'utf8');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  // Very old browsers are only a fallback; encodeURIComponent handles UTF-8
  // code units well enough for the limit display.
  return unescape(encodeURIComponent(text)).length;
}

export function truncateByChars(value = '', max = 0) {
  return [...String(value ?? '')].slice(0, max).join('');
}

export function contentForWechatMeasurement(value = '') {
  // The GUI stores local images as Data URLs, while draft/add receives
  // mmbiz-hosted URLs after the upload step. Measure the post-upload shape so
  // a large local Base64 string does not create a false body-size failure.
  return String(value ?? '').replace(/data:[^"'\s)]+;base64,[A-Za-z0-9+/=]+/g, 'https://mmbiz.qpic.cn/image');
}

export function inspectWechatCover({ width = 0, height = 0, bytes = 0, type = '', kind = 'headline', main = '', sub = '' } = {}) {
  const spec = WECHAT_LIMITS.titleImage[kind === 'square' ? 'square' : 'headline'];
  const hasDimensions = Number(width) > 0 && Number(height) > 0;
  const ratio = hasDimensions ? Number(width) / Number(height) : 0;
  const near = (a, b) => Math.abs(a - b) < 0.03;
  const ratioOk = !hasDimensions || near(ratio, spec.w / spec.h);
  const errors = [];
  const warnings = [];
  if (!hasDimensions) warnings.push('封面尺寸尚未读取，提交前请确认比例和清晰度');
  else if (!ratioOk) errors.push(`比例 ${ratio.toFixed(2)} 非 ${spec.ratio}，上传后可能被裁剪`);
  if (hasDimensions && Number(width) > WECHAT_LIMITS.titleImage.maxWidthPx) errors.push(`宽 ${width}px 超 ${WECHAT_LIMITS.titleImage.maxWidthPx}px`);
  if (Number(bytes) > WECHAT_LIMITS.titleImage.maxBytes) errors.push(`文件 ${(Number(bytes) / 1024 / 1024).toFixed(1)}MB 超 10MB 上限`);
  else if (Number(bytes) > WECHAT_LIMITS.titleImage.recommendMaxBytes) warnings.push(`文件 ${(Number(bytes) / 1024 / 1024).toFixed(2)}MB，建议压到 <1MB`);
  if (type && !WECHAT_LIMITS.titleImage.acceptedTypes.includes(String(type).toLowerCase())) errors.push(`封面格式 ${type} 不支持，请使用 PNG/JPEG`);
  const mainChars = charCount(main);
  const subChars = charCount(sub);
  if (mainChars > WECHAT_LIMITS.titleImage.mainChars) errors.push(`封面主文案超 ${WECHAT_LIMITS.titleImage.mainChars} 字（当前 ${mainChars} 字）`);
  if (subChars > WECHAT_LIMITS.titleImage.subChars) errors.push(`封面副文案超 ${WECHAT_LIMITS.titleImage.subChars} 字（当前 ${subChars} 字）`);
  return { ok: errors.length === 0, kind: kind === 'square' ? 'square' : 'headline', ratio: ratioOk ? spec.ratio : 'nonstandard', fields: { width: Number(width) || 0, height: Number(height) || 0, bytes: Number(bytes) || 0, type: String(type || ''), mainChars, subChars }, errors, warnings, limits: WECHAT_LIMITS.titleImage };
}

function check(id, label, actual, limit, unit, message) {
  const ok = actual <= limit;
  return { id, label, actual, limit, unit, ok, level: ok ? 'ok' : 'error', message: ok ? `${label} ${actual}/${limit}${unit}` : message };
}

/**
 * Validate the fields sent to draft/add.  The content thresholds are strict:
 * WeChat's accepted value is below 20,000 characters and below 1 MiB.
 */
export function inspectWechatArticle({
  title = '',
  author = '',
  digest = '',
  content = '',
  contentSourceUrl = '',
  requireCover = false,
  coverMediaId = ''
} = {}) {
  const measuredContent = contentForWechatMeasurement(content);
  const fields = {
    title: charCount(title),
    author: charCount(author),
    digest: charCount(digest),
    contentChars: charCount(measuredContent),
    contentBytes: byteCount(measuredContent),
    sourceUrlBytes: byteCount(contentSourceUrl)
  };
  const checks = [
    check('title', '标题', fields.title, WECHAT_LIMITS.titleChars, ' 字', `标题超 ${WECHAT_LIMITS.titleChars} 字（当前 ${fields.title} 字），请精简`),
    check('author', '作者', fields.author, WECHAT_LIMITS.authorChars, ' 字', `作者名超 ${WECHAT_LIMITS.authorChars} 字（当前 ${fields.author} 字），请精简`),
    check('digest', '摘要', fields.digest, WECHAT_LIMITS.digestChars, ' 字', `摘要超 ${WECHAT_LIMITS.digestChars} 字（当前 ${fields.digest} 字），请精简`),
    check('contentChars', '正文字符数', fields.contentChars, WECHAT_LIMITS.contentChars - 1, ' 字', `正文超微信上限（需 <${WECHAT_LIMITS.contentChars.toLocaleString('zh-CN')} 字符），当前 ${fields.contentChars} 字符，请拆分`),
    check('contentBytes', '正文大小', fields.contentBytes, WECHAT_LIMITS.contentBytes - 1, 'B', `正文超微信上限（需 <1MB），当前 ${(fields.contentBytes / 1024 / 1024).toFixed(2)}MB，请精简图片或内容`),
    check('sourceUrl', '原文链接', fields.sourceUrlBytes, WECHAT_LIMITS.sourceUrlBytes, ' B', `原文链接超 ${WECHAT_LIMITS.sourceUrlBytes}B，请缩短链接`)
  ];
  if (requireCover) checks.push({ id: 'cover', label: '封面图', actual: coverMediaId ? 1 : 0, limit: 1, unit: '', ok: Boolean(coverMediaId), level: coverMediaId ? 'ok' : 'error', message: coverMediaId ? '封面图已设置' : '微信公众号草稿需要封面图，请插入图片或设置封面素材 ID' });
  return { ok: checks.every(item => item.ok), fields, checks, errors: checks.filter(item => !item.ok), limits: WECHAT_LIMITS };
}

export function formatBytes(value = 0) {
  return `${(Number(value) / 1024 / 1024).toFixed(2)}MB`;
}
