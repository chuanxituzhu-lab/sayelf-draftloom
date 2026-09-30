import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { normalizeWechatAsset, parseImageDataUrl } from '../scripts/wechat-media.mjs';
import { plannedWechatImageType } from '../src/wechat-limits.js';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><rect width="24" height="12" fill="#2f7fe8"/></svg>';

test('parses URL-encoded SVG Data URLs', () => {
  const parsed = parseImageDataUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  assert.equal(parsed.type, 'image/svg+xml');
  assert.equal(parsed.bytes.toString('utf8'), svg);
});

test('converts URL-encoded SVG assets to PNG for WeChat upload', async () => {
  const asset = await normalizeWechatAsset({
    id: 'svg-1',
    name: 'draftloom-section-1.svg',
    type: 'image/svg+xml',
    width: 24,
    height: 12,
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  });
  assert.equal(asset.type, 'image/png');
  assert.equal(asset.name, 'draftloom-section-1.png');
  assert.equal(asset.width, 24);
  assert.equal(asset.height, 12);
  assert.match(asset.dataUrl, /^data:image\/png;base64,/);
  assert.deepEqual([...Buffer.from(asset.dataUrl.split(',')[1], 'base64').subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(asset.convertedFrom, 'draftloom-section-1.svg');
});

test('converts base64 SVG assets from file imports to PNG', async () => {
  const asset = await normalizeWechatAsset({
    name: 'uploaded.svg',
    type: 'image/svg+xml',
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  });
  assert.equal(asset.type, 'image/png');
  assert.match(asset.dataUrl, /^data:image\/png;base64,/);
});

test('leaves supported raster assets as raster assets', async () => {
  const asset = await normalizeWechatAsset({
    id: 'png-1',
    name: 'cover.png',
    type: 'image/png',
    dataUrl: 'data:image/png;base64,AA=='
  });
  assert.equal(asset.type, 'image/png');
  assert.equal(asset.name, 'cover.png');
  assert.equal(asset.size, 1);
  assert.equal(asset.convertedFrom, undefined);
});

test('planned WeChat type matches actual WebP and GIF conversion; unsupported BMP is blocked', async () => {
  const source = sharp({ create: { width: 24, height: 12, channels: 3, background: '#2f7fe8' } });
  const rowBytes = 72;
  const bmp = Buffer.alloc(54 + rowBytes * 12);
  bmp.write('BM', 0, 'ascii');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(24, 18);
  bmp.writeInt32LE(12, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(rowBytes * 12, 34);
  for (const [format, type] of [['webp', 'image/webp'], ['gif', 'image/gif']]) {
    const bytes = await source.clone().toFormat(format).toBuffer();
    const asset = await normalizeWechatAsset({ name: `example.${format}`, type, dataUrl: `data:${type};base64,${bytes.toString('base64')}` });
    assert.equal(plannedWechatImageType(type), 'image/png');
    assert.equal(asset.type, 'image/png');
    assert.equal(asset.name, 'example.png');
    assert.equal(asset.width, 24);
    assert.equal(asset.height, 12);
  }
  assert.equal(plannedWechatImageType('image/bmp'), 'image/bmp');
  await assert.rejects(normalizeWechatAsset({ name: 'example.bmp', type: 'image/bmp', dataUrl: `data:image/bmp;base64,${bmp.toString('base64')}` }), /暂不支持 image\/bmp/);
});
