/** Treat a draft as created only when WeChat confirms it with a draft ID. */
export function verifyWechatDraftResponse(responseOk, body) {
  if (!responseOk) return { ok: false, draftId: null, reason: '微信接口 HTTP 请求未成功' };
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, draftId: null, reason: '微信接口返回无法解析，未能确认草稿创建' };
  }
  if (Number(body.errcode || 0) !== 0) {
    return { ok: false, draftId: null, reason: '微信接口报告创建失败' };
  }
  const draftId = body.media_id || body.draft_id || null;
  if (typeof draftId !== 'string' || !draftId.trim()) {
    return { ok: false, draftId: null, reason: '微信接口未返回草稿编号，无法确认提交成功' };
  }
  return { ok: true, draftId: draftId.trim(), reason: null };
}
