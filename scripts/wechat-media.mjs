import sharp from 'sharp';
import { plannedWechatImageType } from '../src/wechat-limits.js';
import { renderCoverCopyOverlaySvg } from '../src/cover.js';

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
 * Convert unsupported-but-rasterizable assets to a WeChat-compatible PNG. Non-converted
 * assets retain their original content and metadata shape.
 */
export async function normalizeWechatAsset(asset = {}) {
  const parts = parseImageDataUrl(asset.dataUrl);
  if (!parts) throw new Error(`图片 ${asset.name || '未命名'} 不是可上传的本地 Data URL`);
  const sourceType = parts.type === SVG_TYPE || SVG_EXT.test(String(asset.name || '')) ? SVG_TYPE : parts.type;
  const targetType = plannedWechatImageType(sourceType);
  if (!['image/png', 'image/jpeg', 'image/jpg'].includes(targetType)) throw new Error(`微信图片暂不支持 ${sourceType}：${asset.name || '未命名'}`);
  if (targetType !== PNG_TYPE || sourceType === PNG_TYPE) return { ...asset, type: parts.type, size: parts.bytes.length };

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
    throw new Error(`图片 ${asset.name || '未命名'} 转换 PNG 失败：${error.message}`);
  }
}

/** Create a non-destructive, local-only cover derivative with editable copy baked in. */
export async function renderWechatCoverAsset(asset = {}, { main = asset.coverMain || '', sub = asset.coverSub || '' } = {}) {
  const parts = parseImageDataUrl(asset.dataUrl);
  if (!parts) throw new Error(`封面 ${asset.name || '未命名'} 不是可处理的本地 Data URL`);
  const overlay = renderCoverCopyOverlaySvg({ main, sub });
  try {
    const image = sharp(parts.bytes).rotate().resize(900, 383, { fit: 'cover', position: 'centre' });
    if (overlay) image.composite([{ input: Buffer.from(overlay), blend: 'over' }]);
    const png = await image.png().toBuffer();
    const metadata = await sharp(png).metadata();
    return {
      ...asset,
      name: imageNameAsPng(asset.name || 'draftloom-cover.png'),
      type: PNG_TYPE,
      size: png.length,
      width: metadata.width || 900,
      height: metadata.height || 383,
      dataUrl: `data:${PNG_TYPE};base64,${png.toString('base64')}`,
      renderedLocally: true,
      convertedFrom: asset.name || parts.type
    };
  } catch (error) {
    throw new Error(`封面本地渲染失败：${error.message}`);
  }
}
