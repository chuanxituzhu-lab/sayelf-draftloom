import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQrAuthUrl, qrDataUrlForAuthUrl } from '../src/qr-auth.js';

test('QR auth URL validation accepts web URLs and rejects non-web payloads', () => {
  assert.deepEqual(normalizeQrAuthUrl(''), { url: null, error: null });
  assert.equal(normalizeQrAuthUrl(' https://example.com/login ').url, 'https://example.com/login');
  assert.equal(normalizeQrAuthUrl('javascript:alert(1)').url, null);
  assert.match(normalizeQrAuthUrl('javascript:alert(1)').error, /http|https/);
});

test('local QR renderer returns a PNG data URL without network access', async () => {
  const image = await qrDataUrlForAuthUrl('https://example.com/wechat/callback?state=local');
  assert.match(image, /^data:image\/png;base64,/);
  assert.ok(image.length > 500);
});
