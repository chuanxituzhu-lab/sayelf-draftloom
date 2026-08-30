import sharp from 'sharp';

const SVG_TYPE = 'image/svg+xml';
const PNG_TYPE = 'image/png';
const SVG_EXT = /\.svg$/i;

function imageNameAsPng(name = 'image') {
  const base = String(name || 'image').replace(/\.[^.\\/]+$/, '');
  return `${base}.png`;
}
/**
 * Decode both base64 and URL-encoded Data URLs used by imported and generated
 * local assets. The returned bytes never leave this process until the caller
 * explicitly uploads the normalized asset to the configured WeChat endpoint.
 */
export function parseImageDataUrl(dataUrl = '') {
  const match = String(dataUrl).match(/^data:([^,]*),([\s\S]*)$/i);
  if (!match) return null;
  const header = match[1].split(';');
  const type = String(header.shift() || '').toLowerCase();
  if (!type) return null;
  const payload = match[2];
  const isBase64 = header.some(value => value.toLowerCase() === 'base64');
  try {
    return {
      type,
      bytes: isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
    };
  } catch (error) {
    throw new Error(`图片 Data URL 无法解析：${error.message}`);
  }
}

/**
 * Convert only SVG assets to a WeChat-compatible local PNG copy. Non-SVG
 * assets retain their original content and metadata shape.
 */
export async function normalizeWechatAsset(asset = {}) {
  const parts = parseImageDataUrl(asset.dataUrl);
  if (!parts) throw new Error(`图片 ${asset.name || '未命名'} 不是可上传的本地 Data URL`);
  const isSvg = parts.type === SVG_TYPE || SVG_EXT.test(String(asset.name || ''));
  if (!isSvg) return { ...asset, type: parts.type, size: parts.bytes.length };

  try {
    const image = sharp(parts.bytes);
    const metadata = await image.metadata();
    const pngBytes = await image.png().toBuffer();
    return {
      ...asset,
      name: imageNameAsPng(asset.name),
      type: PNG_TYPE,
      size: pngBytes.length,
      width: metadata.width || asset.width || 0,
      height: metadata.height || asset.height || 0,
      dataUrl: `data:${PNG_TYPE};base64,${pngBytes.toString('base64')}`,
      convertedFrom: asset.name || SVG_TYPE
    };
  } catch (error) {
    throw new Error(`SVG 图片 ${asset.name || '未命名'} 转换 PNG 失败：${error.message}`);
  }
}
