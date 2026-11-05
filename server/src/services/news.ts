import { unavailable } from '../middleware/errors.js';

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  summary: string;
  imageUrl: string | null;
  source: string;
  topic: string;
  publishedAt: string | null;
}

export interface NewsSource {
  name: string;
  url: string;
  topic: string;
  filter?: RegExp;
}

export interface NewsFeed {
  fetchedAt: string;
  stale: boolean;
  sources: Array<Pick<NewsSource, 'name' | 'url' | 'topic'>>;
  items: NewsItem[];
}

const CACHE_TTL_MS = 5 * 60_000;
const RETRY_AFTER_FAILURE_MS = 60_000;
const FEED_TIMEOUT_MS = 10_000;
const MAX_ITEMS = 30;

const MUMBAI_ENVIRONMENT =
  /\b(air pollution|pollut\w*|smog|aqi|environment\w*|climate|emission\w*|waste|garbage|sewage|water|flood\w*|rain\w*|drought|heatwave|heat wave|dust|mangrove\w*|coastal|firecrack\w*|monsoon|wildlife|forest\w*|biodiversity|conservation)\b/i;

const FEEDS: NewsSource[] = [
  {
    name: 'The Guardian',
    url: 'https://www.theguardian.com/environment/air-pollution/rss',
    topic: 'Air pollution',
  },
  {
    name: 'The Hindu',
    url: 'https://www.thehindu.com/news/cities/mumbai/feeder/default.rss',
    topic: 'Mumbai',
    filter: MUMBAI_ENVIRONMENT,
  },
  {
    name: 'The Hindu',
    url: 'https://www.thehindu.com/sci-tech/energy-and-environment/feeder/default.rss',
    topic: 'Environment',
  },
  {
    name: 'Mongabay India',
    url: 'https://india.mongabay.com/feed/',
    topic: 'Environment',
  },
  {
    name: 'Hindustan Times',
    url: 'https://www.hindustantimes.com/feeds/rss/cities/mumbai-news/rssfeed.xml',
    topic: 'Mumbai',
    filter: MUMBAI_ENVIRONMENT,
  },
  {
    name: 'The Indian Express',
    url: 'https://indianexpress.com/feed/',
    topic: 'India',
    filter: MUMBAI_ENVIRONMENT,
  },
  {
    name: 'BBC News',
    url: 'https://feeds.bbci.co.uk/news/world/asia/india/rss.xml',
    topic: 'India',
    filter: MUMBAI_ENVIRONMENT,
  },
];

// Deliberately strict: only safety-relevant stories generate an email. A
// generic "pollution" story stays in the news feed but does not notify users.
const CRITICAL_NEWS =
  /\b(critical|severe|extreme|emergency|hazardous|red alert|orange alert|cyclone|flood\w*|landslide|gas leak|toxic|chemical leak|oil spill|explosion|blaze|major fire|heatwave|heat wave|air quality (severe|very poor|hazardous)|smog|water contamination|evacuat\w*|deaths?|killed|schools? (shut|closed)|section 144|health emergency)\b/i;

export function isCriticalNews(item: NewsItem): boolean {
  return CRITICAL_NEWS.test(`${item.title} ${item.summary}`);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function plainText(value: string): string {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return match?.[1]?.trim() ?? null;
}

function summaryFrom(block: string): string {
  const description = tag(block, 'description');
  if (!description) return '';
  const text = plainText(description).replace(/\s*Continue reading\.{0,3}\s*$/i, '');
  return text.length > 220 ? `${text.slice(0, 220).replace(/\s+\S*$/, '')}…` : text;
}

function imageFrom(block: string): string | null {
  const candidates = [...block.matchAll(/<media:content\b[^>]*\burl="([^"]+)"[^>]*>/gi)]
    .map((match) => ({
      url: decodeEntities(match[1]),
      width: Number(match[0].match(/\bwidth="(\d+)"/)?.[1] ?? 0),
    }))
    .filter((candidate) => /^https?:\/\//i.test(candidate.url));
  candidates.sort((a, b) => Math.abs(a.width - 700) - Math.abs(b.width - 700));
  if (candidates[0]) return candidates[0].url;
  const enclosure = block.match(/<enclosure\b[^>]*\burl="([^"]+)"/i)?.[1];
  return enclosure ? decodeEntities(enclosure) : null;
}

/** Parses RSS 2.0 items. Exported so the feed contract is testable without the network. */
export function parseNewsFeed(xml: string, source: NewsSource): NewsItem[] {
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  return blocks.flatMap((block) => {
    const title = plainText(tag(block, 'title') ?? '');
    const url = plainText(tag(block, 'link') ?? '');
    if (!title || !/^https?:\/\//i.test(url)) return [];
    const rawDate = plainText(tag(block, 'dc:date') ?? tag(block, 'pubDate') ?? '');
    const parsed = rawDate ? new Date(rawDate) : null;
    const item: NewsItem = {
      id: plainText(tag(block, 'guid') ?? '') || url,
      title,
      url,
      summary: summaryFrom(block),
      imageUrl: imageFrom(block),
      source: source.name,
      topic: source.topic,
      publishedAt: parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null,
    };
    if (source.filter && !source.filter.test(item.title)) return [];
    return [item];
  });
}

async function fetchFeed(source: NewsSource): Promise<NewsItem[]> {
  const response = await fetch(source.url, {
    headers: { 'user-agent': 'Prakriti/1.0 (environmental news reader)', accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${source.name} feed returned ${response.status}`);
  return parseNewsFeed(await response.text(), source);
}

let cache: { at: number; items: NewsItem[] } | null = null;
let retryAt = 0;

export async function getEnvironmentalNews(): Promise<NewsFeed> {
  const sources = FEEDS.map(({ name, url, topic }) => ({ name, url, topic }));
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { fetchedAt: new Date(cache.at).toISOString(), stale: false, sources, items: cache.items };
  }
  if (Date.now() < retryAt) {
    if (cache) return { fetchedAt: new Date(cache.at).toISOString(), stale: true, sources, items: cache.items };
    throw unavailable('The news feeds are temporarily unavailable. Please try again shortly.');
  }

  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const items = results
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index)
    .slice(0, MAX_ITEMS);

  if (items.length === 0) {
    retryAt = Date.now() + RETRY_AFTER_FAILURE_MS;
    if (cache) return { fetchedAt: new Date(cache.at).toISOString(), stale: true, sources, items: cache.items };
    throw unavailable('The news feeds are temporarily unavailable. Please try again shortly.');
  }

  cache = { at: Date.now(), items };
  retryAt = 0;
  return { fetchedAt: new Date(cache.at).toISOString(), stale: false, sources, items };
}
