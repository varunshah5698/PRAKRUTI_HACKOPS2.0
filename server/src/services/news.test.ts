import { describe, expect, it } from 'vitest';
import { isCriticalNews, parseNewsFeed, type NewsItem, type NewsSource } from './news.js';

const source: NewsSource = {
  name: 'The Guardian',
  url: 'https://www.theguardian.com/environment/air-pollution/rss',
  topic: 'Air pollution',
};

const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Greener front gardens &amp; cleaner air</title>
      <link>https://www.theguardian.com/environment/2026/oct/30/gardens</link>
      <description>&lt;p&gt;Study finds &lt;strong&gt;planting&lt;/strong&gt; helps.&lt;/p&gt;&lt;a href="x"&gt;Continue reading...&lt;/a&gt;</description>
      <category>Air pollution</category>
      <pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate>
      <media:content width="140" url="https://img.example.com/140.jpg"><media:credit>Photo</media:credit></media:content>
      <media:content width="700" url="https://img.example.com/700.jpg?width=700&amp;quality=85"><media:credit>Photo</media:credit></media:content>
      <media:content width="460" url="https://img.example.com/460.jpg"><media:credit>Photo</media:credit></media:content>
    </item>
    <item>
      <title><![CDATA[Mumbai firecracker ban returns]]></title>
      <link>https://www.thehindu.com/news/mumbai/firecrackers.ece</link>
      <description><![CDATA[The BMC tightened rules before Deepavali.]]></description>
      <media:content height="675" url="https://img.example.com/1200.jpg" width="1200" />
      <pubDate>Tue, 03 Nov 2026 09:00:00 +0530</pubDate>
    </item>
    <item>
      <title>Broken item</title>
      <link>not-a-url</link>
    </item>
  </channel>
</rss>`;

describe('environmental news feed parser', () => {
  it('parses titles, summaries, images and dates', () => {
    const items = parseNewsFeed(xml, source);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Greener front gardens & cleaner air',
      summary: 'Study finds planting helps.',
      imageUrl: 'https://img.example.com/700.jpg?width=700&quality=85',
      source: 'The Guardian',
      topic: 'Air pollution',
      publishedAt: '2026-10-30T10:00:00.000Z',
    });
    expect(items[1].title).toBe('Mumbai firecracker ban returns');
    expect(items[1].imageUrl).toBe('https://img.example.com/1200.jpg');
  });

  it('filters local headlines to environmental stories', () => {
    const local: NewsSource = { ...source, name: 'The Hindu', filter: /firecracker/i };
    const feed = `<rss><channel>
      <item><title>Mumbai cricket team wins</title><link>https://example.com/cricket</link></item>
      <item><title>Firecracker ban returns</title><link>https://example.com/firecracker</link></item>
    </channel></rss>`;
    expect(parseNewsFeed(feed, local).map((item) => item.title)).toEqual(['Firecracker ban returns']);
  });

  it('only treats safety-relevant stories as critical news', () => {
    const item = (title: string, summary = ''): NewsItem => ({
      id: title,
      title,
      summary,
      url: 'https://example.com',
      imageUrl: null,
      source: 'Test',
      topic: 'Mumbai',
      publishedAt: null,
    });
    expect(isCriticalNews(item('Mumbai flood warning issued for low-lying areas'))).toBe(true);
    expect(isCriticalNews(item('Gas leak reported near Chembur'))).toBe(true);
    expect(isCriticalNews(item('New garden opens in Bandra'))).toBe(false);
    expect(isCriticalNews(item('Weekend guide: best cafes in Mumbai'))).toBe(false);
  });
});
