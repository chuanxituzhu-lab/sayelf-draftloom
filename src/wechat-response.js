/** Treat a draft as created only when WeChat confirms it with a draft ID. */
const WECHAT_ERROR_GUIDANCE = {
  40001: 'access_token 无效或过期，请检查本机授权配置',
  40007: 'media_id 无效，封面素材可能已失效',
  40009: '图片超出大小限制（≤10MB）',
  40164: '调用 IP 不在公众号白名单，请将微信原始错误中显示的公网出口 IP 加入白名单',
  41001: '缺少 access_token 参数',
  45009: '接口调用频次超限',
  45166: '内容含敏感词或非法 HTML 标签，请检查正文',
  48001: '接口未授权，需认证公众号并开通草稿箱权限',
  53404: '账号已被限制，无法新建草稿'
};

/** Preserve WeChat's original errmsg (notably the actual IP in 40164) alongside local guidance. */
export function describeWechatError(body = {}) {
  const code = Number(body?.errcode);
  const guidance = WECHAT_ERROR_GUIDANCE[code];
  const original = typeof body?.errmsg === 'string' ? body.errmsg.trim().slice(0, 500) : '';
  if (guidance && original) return `[${code}] ${original}。${guidance}`;
  if (guidance) return `[${code}] ${guidance}`;
  if (original) return `[${Number.isFinite(code) && code ? code : '?'}] ${original}`;
  return '';
}

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
