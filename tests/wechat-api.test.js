import assert from 'node:assert/strict';
import test from 'node:test';
import { assertWechatApiEndpoint, fetchWechatDraftPage, redactWechatToken } from '../scripts/wechat-api.mjs';

test('公众号接口地址只接受官方 HTTPS 或本机适配器，不接受凭据和外部端口', () => {
  assert.equal(assertWechatApiEndpoint('https://api.weixin.qq.com/cgi-bin/draft/batchget').hostname, 'api.weixin.qq.com');
  assert.equal(assertWechatApiEndpoint('http://127.0.0.1:4177/api/wechat/mock').hostname, '127.0.0.1');
  assert.throws(() => assertWechatApiEndpoint('https://user:pass@api.weixin.qq.com/cgi-bin/token'), /只允许官方 HTTPS/);
  assert.throws(() => assertWechatApiEndpoint('https://api.weixin.qq.com:8443/cgi-bin/token'), /只允许官方 HTTPS/);
  assert.throws(() => assertWechatApiEndpoint('https://example.com/cgi-bin/token'), /只允许官方 HTTPS/);
});

test('微信错误信息若包含凭据也必须隐藏', () => {
  assert.equal(redactWechatToken('错误 token=private-test-value', 'private-test-value'), '错误 token=[已隐藏凭据]');
});

test('历史草稿页使用官方分页参数并在调用者请求时包含正文', async () => {
  let requestedUrl;
  let requestBody;
  const result = await fetchWechatDraftPage({
    token: 'local-test-token', offset: 40, count: 200, endpoint: 'https://api.weixin.qq.com/cgi-bin/draft/batchget',
    fetchImpl: async (url, options) => {
      requestedUrl = String(url);
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ total_count: 41, item: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  assert.equal(new URL(requestedUrl).searchParams.get('access_token'), 'local-test-token');
  assert.deepEqual(requestBody, { offset: 40, count: 20, no_content: 0 });
  assert.equal(result.total_count, 41);
});

test('微信错误响应不会把 access_token 写入错误消息', async () => {
  await assert.rejects(fetchWechatDraftPage({
    token: 'never-expose-this-token', endpoint: 'https://api.weixin.qq.com/cgi-bin/draft/batchget',
    fetchImpl: async () => new Response(JSON.stringify({ errcode: 40164, errmsg: 'invalid ip 203.0.113.5 not in whitelist' }), { status: 200 })
  }), error => {
    assert.match(error.message, /40164|白名单/);
    assert.doesNotMatch(error.message, /never-expose-this-token/);
    return true;
  });
});
