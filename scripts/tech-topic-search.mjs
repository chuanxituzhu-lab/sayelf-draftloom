import { TECH_TOPICS, assessTopicSources } from '../src/tech-topics.js';

const FEEDS = Object.freeze([
  { url: 'https://www.ithome.com/rss/', publisher: 'IT之家', publisherUrl: 'https://www.ithome.com' },
  { url: 'https://www.qbitai.com/feed', publisher: '量子位', publisherUrl: 'https://www.qbitai.com' },
  { url: 'https://www.geekpark.net/rss', publisher: '极客公园', publisherUrl: 'https://www.geekpark.net' }
]);
const ALLOWED_HOSTS = new Set(FEEDS.map(feed => new URL(feed.url).hostname));

function xmlText(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]*>/g, '').trim();
}

export function parseNewsFeed(xml, feed = {}) {
  return [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].slice(0, 60).map(([, item]) => {
    const tag = name => xmlText(item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`))?.[1] || '');
    const link = tag('link');
    const sourceUrl = xmlText(item.match(/<source\b[^>]*url="([^"]+)"/)?.[1] || '');
    let publisherUrl = feed.publisherUrl || '';
    try { if (!publisherUrl && ALLOWED_HOSTS.has(new URL(sourceUrl).hostname)) publisherUrl = sourceUrl; } catch { /* Ignore untrusted publisher metadata. */ }
    if (!publisherUrl) return null;
    let articleUrl = publisherUrl;
    try {
      const parsed = new URL(link);
      if (parsed.protocol === 'https:' && ALLOWED_HOSTS.has(parsed.hostname)) articleUrl = parsed.href;
    } catch { /* Keep the trusted publisher homepage as the evidence link. */ }
    return { title: tag('title'), publishedAt: tag('pubDate') || tag('published') || tag('updated'), publisher: feed.publisher || tag('source') || new URL(publisherUrl).hostname, publisherUrl, url: articleUrl };
  }).filter(Boolean);
}

let cache;
let pending;
export async function searchTechTopics() {
  if (cache && Date.now() - Date.parse(cache.checkedAt) < 30 * 60000) return cache;
  if (pending) return pending;
  pending = (async () => {
    const errors = [];
    const feeds = await Promise.all(FEEDS.map(async feed => {
      try {
        const response = await fetch(feed.url, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { accept: 'application/rss+xml, application/xml, text/xml' } });
        if (!response.ok) throw new Error('HTTP_ERROR');
        const xml = await response.text();
        if (xml.length > 1000000 || !/<(?:rss|feed)\b/i.test(xml)) throw new Error('INVALID_FEED');
        return parseNewsFeed(xml, feed);
      } catch { errors.push(`${feed.publisher}订阅源暂不可用`); return []; }
    }));
    const reports = feeds.flat();
    const topics = TECH_TOPICS.map(topic => assessTopicSources(topic, reports));
    const result = { checkedAt: new Date().toISOString(), topics, errors, provider: 'domestic-tech-media-rss', sources: FEEDS.map(({ publisher, url }) => ({ publisher, url })), windowDays: 7, wechatRankVerified: false };
    if (!errors.length) cache = result;
    return result;
  })();
  try { return await pending; } finally { pending = null; }
}
