import test from 'node:test';
import assert from 'node:assert/strict';
import { TECH_TOPICS, assessTopicSources, verifiedTopics } from '../src/tech-topics.js';
import { parseNewsFeed } from '../scripts/tech-topic-search.mjs';
import { generateArticleKeywords, evaluateHotTopicFit } from '../src/visuals.js';

const now = Date.parse('2026-10-09T00:00:00Z');
const source = (domain, title = 'ChatGPT新功能发布', publishedAt = '2026-10-08T00:00:00Z') => ({ title, publishedAt, publisherUrl: `https://www.${domain}`, url: `https://www.${domain}/news`, publisher: domain });
test('cross-check requires fresh, distinct publishers and distinct reports', () => {
  const topic = TECH_TOPICS[0];
  assert.equal(assessTopicSources(topic, [source('ithome.com'), source('ithome.com', 'ChatGPT第二报道')], now).status, 'unverified');
  assert.equal(assessTopicSources(topic, [source('ithome.com'), source('qbitai.com')], now).status, 'unverified');
  assert.equal(assessTopicSources(topic, [source('ithome.com'), source('qbitai.com', 'ChatGPT应用观察')], now).status, 'corroborated');
  assert.equal(assessTopicSources(topic, [source('ithome.com'), source('qbitai.com', 'ChatGPT旧消息', '2025-10-01T00:00:00Z')], now).status, 'unverified');
  assert.equal(assessTopicSources(topic, [source('ithome.com'), source('qbitai.com', '无关消息')], now).status, 'unverified');
  assert.equal(assessTopicSources(topic, [source('example.com'), source('foreign.example', 'ChatGPT另一篇报道')], now).status, 'unverified');
});
test('expired evidence and hand-entered topics do not become verified heat', () => {
  const topic = assessTopicSources(TECH_TOPICS[0], [source('ithome.com'), source('qbitai.com', 'ChatGPT应用观察')], now);
  assert.equal(verifiedTopics({ checkedAt: new Date(now).toISOString(), topics: [topic] }, now).length, 1);
  assert.equal(verifiedTopics({ checkedAt: '2026-10-01', topics: [topic] }, now).length, 0);
  assert.equal(evaluateHotTopicFit({ text: 'ChatGPT与AI', hotTopics: 'ChatGPT' }).verified, false);
});
test('canonical technology tags require article mentions and do not get forced into unrelated articles', () => {
  const plan = generateArticleKeywords({ text: '使用 chatgpt、codex、Claude Code、workbuddy 编程。' });
  for (const tag of ['#ChatGPT', '#Codex', '#ClaudeCode', '#WorkBuddy']) assert.ok(plan.hashtags.includes(tag));
  const unrelated = generateArticleKeywords({ text: '山野茶的清香来自茶山自然环境。' });
  assert.ok(!unrelated.hashtags.includes('#ChatGPT'));
});
test('RSS parsing extracts public source, date and title without interpreting markup', () => {
  const xml = '<rss><channel><item><title>ChatGPT &amp; AI</title><link>https://untrusted.invalid/articles/x</link><pubDate>Thu, 08 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>';
  const [parsed] = parseNewsFeed(xml, { publisher: 'IT之家', publisherUrl: 'https://www.ithome.com' });
  assert.equal(parsed.title, 'ChatGPT & AI');
  assert.equal(parsed.publisherUrl, 'https://www.ithome.com');
  assert.equal(parsed.url, 'https://www.ithome.com');
});
