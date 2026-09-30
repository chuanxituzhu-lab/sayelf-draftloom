import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyWechatDraftResponse } from '../src/wechat-response.js';

test('only a successful WeChat response with a draft ID is reported as submitted', () => {
  assert.deepEqual(verifyWechatDraftResponse(true, { errcode: 0, media_id: 'draft-media-1' }), {
    ok: true,
    draftId: 'draft-media-1',
    reason: null
  });
  assert.equal(verifyWechatDraftResponse(true, { draft_id: 'draft-2' }).ok, true);
});

test('HTTP 200 without a parseable response or draft ID never becomes false success', () => {
  assert.equal(verifyWechatDraftResponse(true, null).ok, false);
  assert.match(verifyWechatDraftResponse(true, { errcode: 0 }).reason, /未返回草稿编号/);
  assert.equal(verifyWechatDraftResponse(false, { errcode: 0, media_id: 'draft-3' }).ok, false);
  assert.equal(verifyWechatDraftResponse(true, { errcode: 40001, errmsg: 'invalid token' }).ok, false);
});
