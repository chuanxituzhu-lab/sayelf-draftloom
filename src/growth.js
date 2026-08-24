import { renderArticleHtml } from './core.js';
import { inspectWechatArticle } from './wechat-limits.js';

const DEFAULT_PROFILE = {
  accountName: 'SAYELF山野精灵',
  positioning: '山野茶事、自然生活与真实体验',
  audience: '喜欢茶、自然生活和山野体验的人',
  tone: '自然、真诚、克制、温暖',
  targetKeywords: ['山野精灵', '山野茶', '自然生活', '茶'],
  cta: '如果你也喜欢这样的山野生活，欢迎留言交流。'
};

const HOOK_SIGNALS = ['为什么', '别再', '千万', '原来', '终于', '第一次', '真相', '秘密', '错误', '你知道', '教你', '居然', '竟然', '免费', '亲测', '避坑'];
const CTA_WORDS = ['关注', '收藏', '评论', '点赞', '转发', '留言', '交流', '订阅'];
const BLOCKED_TERMS = ['保证赚钱', '包治百病', '绝对安全'];

export function normalizeGrowthProfile(input = {}) {
  const value = { ...DEFAULT_PROFILE, ...input };
  const keywords = Array.isArray(value.targetKeywords) ? value.targetKeywords : String(value.targetKeywords || '').split(/[,，\n]/);
  return {
    accountName: String(value.accountName || DEFAULT_PROFILE.accountName).trim(),
    positioning: String(value.positioning || DEFAULT_PROFILE.positioning).trim(),
    audience: String(value.audience || DEFAULT_PROFILE.audience).trim(),
    tone: String(value.tone || DEFAULT_PROFILE.tone).trim(),
    targetKeywords: keywords.map(item => String(item).trim()).filter(Boolean).slice(0, 12),
    cta: String(value.cta || DEFAULT_PROFILE.cta).trim()
  };
}

export function getDefaultGrowthProfile() { return normalizeGrowthProfile(); }

function documentText(doc) {
  return (doc?.blocks || []).map(block => block.text || (block.items || []).join(' | ') || '').filter(Boolean).join('\n');
}

function hasCover(doc) {
  const assets = new Set((doc?.assets || []).map(asset => asset.id));
  return (doc?.blocks || []).some(block => (block.type === 'image' && assets.has(block.assetId)) || (block.type === 'gallery' && (block.assetIds || []).some(id => assets.has(id))));
}

function signal(name, score, weight, hint = '') { return { name, score, weight, hint }; }

function scoreGrowth(doc, profile) {
  const title = String(doc?.title || '').trim();
  const body = documentText(doc);
  const firstLine = body.split(/\n+/).map(line => line.trim()).find(Boolean) || title;
  const keywords = profile.targetKeywords;
  const hasSignal = HOOK_SIGNALS.some(word => firstLine.includes(word));
  const hasQuestionOrNumber = /[?？]|\d/.test(firstLine);
  const concise = firstLine.length > 0 && firstLine.length <= 40;
  const hookHits = Number(hasSignal) + Number(hasQuestionOrNumber) + Number(concise);
  const hookScore = { 0: 15, 1: 45, 2: 75, 3: 100 }[hookHits];
  const front = title.slice(0, 12);
  const titleScore = keywords.length ? (keywords.some(word => front.includes(word)) ? 100 : 40) : (title.length >= 6 ? 80 : 45);
  const keywordHits = keywords.filter(word => `${title}\n${body}`.includes(word)).length;
  const keywordScore = keywords.length ? Math.round(40 + 60 * Math.min(keywordHits / keywords.length, 1)) : 70;
  const lengthScore = body.length < 400 ? Math.max(20, Math.round(40 * body.length / 400)) : body.length > 20000 ? 25 : 90;
  const coverScore = hasCover(doc) ? 100 : 45;
  const ctaScore = CTA_WORDS.some(word => `${title}\n${body}`.includes(word)) || profile.cta && body.includes(profile.cta) ? 100 : 55;
  const signals = [
    signal('hook_strength', hookScore, 2, hookScore < 70 ? '把最抓人的信息放在第一句，用疑问、反常识或数字制造好奇，控制在 40 字以内。' : ''),
    signal('title_front_load', titleScore, 3, titleScore < 70 ? `把核心关键词前置到标题前 12 字：${keywords.join('、') || '请配置关键词'}。` : ''),
    signal('keyword_coverage', keywordScore, 1.2, keywordScore < 70 ? `正文关键词覆盖偏低（${keywordHits}/${keywords.length}），请自然补充地域、人群、场景词。` : ''),
    signal('length_fit', lengthScore, 0.8, lengthScore < 70 ? (body.length < 400 ? '正文信息密度偏低，建议补充真实细节、过程和结论。' : '正文超过微信草稿限制，建议拆分为系列文章。') : ''),
    signal('cover_quality', coverScore, 1.5, coverScore < 70 ? '请在文章中插入一张能表达主题的首图作为封面。' : ''),
    signal('cta_presence', ctaScore, 1.2, ctaScore < 70 ? `结尾加入自然互动引导：${profile.cta}` : '')
  ];
  const totalWeight = signals.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.round(signals.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight);
  return { score, tier: score >= 75 ? 'strong' : score >= 55 ? 'promising' : 'weak', signals, suggestions: signals.filter(item => item.hint).map(item => item.hint) };
}

function compliance(doc) {
  const title = String(doc?.title || '').trim();
  const body = documentText(doc);
  const checks = [];
  const requiredMissing = [!title && '标题', !body && '正文', !hasCover(doc) && '封面图'].filter(Boolean);
  checks.push({ name: 'required_fields', passed: requiredMissing.length === 0, score: requiredMissing.length ? 0 : 100, messages: requiredMissing.length ? [`缺少：${requiredMissing.join('、')}`] : [] });
  const wechatValidation = inspectWechatArticle({ title, author: doc?.author || '', digest: doc?.subtitle || '', content: renderArticleHtml(doc) });
  const limitIssues = wechatValidation.errors.map(item => item.message);
  checks.push({ name: 'wechat_limits', passed: limitIssues.length === 0, score: limitIssues.length ? 40 : 100, messages: limitIssues });
  const found = BLOCKED_TERMS.filter(term => `${title}\n${body}`.includes(term));
  checks.push({ name: 'blocked_terms', passed: found.length === 0, score: found.length ? 0 : 100, messages: found.map(term => `需人工检查敏感表述：${term}`) });
  checks.push({ name: 'human_review_boundary', passed: true, score: 100, messages: ['必须由人工审核后在公众号后台发送'] });
  const hardBlock = checks.some(item => !item.passed && ['required_fields', 'blocked_terms'].includes(item.name));
  const score = Math.round(checks.reduce((sum, item) => sum + item.score, 0) / checks.length);
  return { decision: hardBlock ? 'BLOCKED' : score >= 75 ? 'READY_FOR_DRAFT' : 'NEEDS_REVIEW', score, checks };
}

export function growthBrief(doc, profileInput = {}) {
  const profile = normalizeGrowthProfile(profileInput);
  const title = String(doc?.title || '').trim();
  const keyword = profile.targetKeywords[0] || profile.positioning;
  const opening = documentText(doc).split(/\n+/).map(line => line.trim()).find(Boolean) || '';
  return {
    account: profile.accountName,
    creativeDirection: `围绕“${profile.positioning}”，面向${profile.audience}，采用${profile.tone}的表达。`,
    titleSuggestions: [
      `${keyword}：一个真实的山野生活片段`,
      `为什么越来越多人重新喜欢上${keyword}？`,
      `从一次真实体验，聊聊${keyword}背后的生活方式`
    ],
    openingSuggestion: opening && opening.length <= 40 ? opening : `先讲一个关于${keyword}的真实细节，再给出读者能带走的结论。`,
    outline: ['开场：一个具体的人、时间、地点或细节', '展开：过程中的观察与真实感受', '提炼：读者可以理解或实践的 3 个要点', '收束：回到山野生活的价值，并留下自然互动引导'],
    ctaSuggestion: profile.cta,
    editorInstructions: [`标题前 12 字尽量出现“${keyword}”`, '减少空泛形容词，补充真实细节和可验证过程', '一段只表达一个重点，使用小标题和引用形成阅读节奏', '保持人工审核，不自动发布']
  };
}

export function analyzeGrowth(doc, profileInput = {}) {
  const profile = normalizeGrowthProfile(profileInput);
  const report = compliance(doc);
  const viral = scoreGrowth(doc, profile);
  return { profile, compliance: report, viral, brief: growthBrief(doc, profile) };
}
