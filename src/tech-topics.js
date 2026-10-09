export const TECH_TOPICS = Object.freeze([
  { keyword: 'ChatGPT', query: 'ChatGPT', aliases: ['chatgpt'] },
  { keyword: 'Codex', query: 'OpenAI Codex', aliases: ['codex'] },
  { keyword: 'ClaudeCode', query: 'Claude Code', aliases: ['claude code', 'claudecode'] },
  { keyword: 'WorkBuddy', query: '腾讯 WorkBuddy', aliases: ['workbuddy', 'work buddy'] }
]);

const DOMESTIC_MEDIA_HOSTS = new Set(['www.ithome.com', 'www.qbitai.com', 'www.geekpark.net']);

export function isDomesticTopicSource(source) {
  try {
    const publisherUrl = new URL(source.publisherUrl || source.url);
    const articleUrl = new URL(source.url || source.publisherUrl);
    return publisherUrl.protocol === 'https:' && articleUrl.protocol === 'https:' && DOMESTIC_MEDIA_HOSTS.has(publisherUrl.hostname.toLowerCase()) && DOMESTIC_MEDIA_HOSTS.has(articleUrl.hostname.toLowerCase());
  } catch { return false; }
}

export function topicMentioned(text, topic) {
  return topic.aliases.some(alias => new RegExp(`\\b${alias.replace(/ /g, '\\s*')}\\b`, 'i').test(String(text)));
}

export function verifiedTopics(evidence, now = Date.now()) {
  if (!evidence || !Number.isFinite(Date.parse(evidence.checkedAt)) || now - Date.parse(evidence.checkedAt) > 86400000 || Date.parse(evidence.checkedAt) > now + 60000) return [];
  return (evidence.topics || []).map(topic => {
    const definition = TECH_TOPICS.find(item => item.keyword === topic.keyword);
    return definition ? assessTopicSources(definition, topic.sources || [], now) : null;
  }).filter(topic => topic?.status === 'corroborated');
}

export function assessTopicSources(topic, sources, now = Date.now()) {
  const unique = new Map();
  const titles = new Set();
  for (const source of sources) {
    if (!isDomesticTopicSource(source)) continue;
    const date = Date.parse(source.publishedAt);
    if (!Number.isFinite(date) || date > now + 60000 || now - date > 7 * 86400000 || !topicMentioned(source.title, topic)) continue;
    let publisherDomain;
    try { const url = new URL(source.publisherUrl); if (url.protocol !== 'https:') continue; const parts = url.hostname.toLowerCase().replace(/^www\./, '').split('.'); publisherDomain = parts.slice(/\.(?:com|co)\.(?:cn|uk|jp)$/.test(url.hostname) ? -3 : -2).join('.'); if (parts.length < 2) continue; } catch { continue; }
    const titleKey = source.title.toLowerCase().replace(/\s+-\s+[^-]+$/, '').replace(/[^\p{L}\p{N}]/gu, '');
    if (titles.has(titleKey) || unique.has(publisherDomain)) continue;
    titles.add(titleKey);
    unique.set(publisherDomain, { ...source, publisherDomain });
  }
  return { keyword: topic.keyword, status: unique.size >= 2 ? 'corroborated' : 'unverified', sources: [...unique.values()].slice(0, 4), signal: 'recent-news-coverage', wechatRankVerified: false };
}
