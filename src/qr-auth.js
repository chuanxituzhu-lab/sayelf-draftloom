import QRCode from 'qrcode';

export function normalizeQrAuthUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return { url: null, error: null };
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('授权入口必须使用 http 或 https');
    return { url: raw, error: null };
  } catch (error) {
    return { url: null, error: error.message || '授权入口 URL 无效' };
  }
}

export async function qrDataUrlForAuthUrl(value = '') {
  const normalized = normalizeQrAuthUrl(value);
  if (!normalized.url) throw new Error(normalized.error || '尚未配置授权入口 URL');
  return QRCode.toDataURL(normalized.url, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#17324d', light: '#ffffffff' }
  });
}
