import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { ArrowUpRight, Clock3, Newspaper, RefreshCw, Rss } from 'lucide-react';
import { Button, Card, DataLabel } from './ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';

interface NewsItem {
  id: string;
  title: string;
  url: string;
  summary: string;
  imageUrl: string | null;
  source: string;
  topic: string;
  publishedAt: string | null;
}

interface NewsFeed {
  fetchedAt: string;
  stale: boolean;
  sources: Array<{ name: string; url: string; topic: string }>;
  items: NewsItem[];
}

const POLL_MS = 10 * 60_000;

function hideBrokenImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none';
}

function thumbUrl(url: string): string {
  // The Hindu CDN offers a small variant. Guardian URLs are signed, so their
  // width cannot be rewritten without breaking the signature.
  return url.replace('/LANDSCAPE_1200/', '/LANDSCAPE_215/');
}

function Thumb({ item }: { item: NewsItem }) {
  return (
    <span className="relative flex h-[52px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-[radial-gradient(120%_120%_at_20%_0%,#e7eefb_0%,#e6e4f7_46%,#dcebd5_100%)] ring-1 ring-white/80">
      <Rss className="h-4 w-4 text-[#718b7a]" strokeWidth={1.6} />
      {item.imageUrl ? (
        <img
          src={thumbUrl(item.imageUrl)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={hideBrokenImage}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}

function Skeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 px-5 pt-5">
        <div className="h-10 w-10 animate-pulse rounded-[14px] bg-[#e5ece1]" />
        <div className="space-y-2">
          <div className="h-3 w-48 animate-pulse rounded-full bg-[#e5ece1]" />
          <div className="h-2 w-64 animate-pulse rounded-full bg-[#eef2ea]" />
        </div>
      </div>
      <div className="grid gap-4 p-5 lg:grid-cols-12">
        <div className="min-h-[320px] animate-pulse rounded-[22px] bg-[#e9f0e5] lg:col-span-7" />
        <div className="space-y-2 lg:col-span-5">
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="h-[62px] animate-pulse rounded-[16px] bg-[#eef2ea]" />
          ))}
        </div>
      </div>
    </Card>
  );
}

/**
 * Live environmental headlines from public RSS feeds. The server proxy caches
 * the feeds for ten minutes, so this panel refreshes without browser CORS or
 * hammering the publishers.
 */
export function LiveNews() {
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    api
      .get<NewsFeed>('/news')
      .then((result) => {
        setFeed(result);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load live news'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && !feed) return <Skeleton />;

  if (!feed || feed.items.length === 0) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-gradient-to-br from-[#dbeafe] via-[#ece7ff] to-[#dcfce7] text-[#3e5f83] ring-1 ring-white/80">
            <Newspaper className="h-[18px] w-[18px]" strokeWidth={1.6} />
          </span>
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.01em] text-[#142016]">Live environmental news</p>
            <p className="mt-0.5 text-[10px] text-[#66766b]">{error ?? 'The news feeds have no recent headlines.'}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Retry
        </Button>
      </Card>
    );
  }

  const [feature, ...rest] = feed.items;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-[14px] bg-gradient-to-br from-[#dbeafe] via-[#ece7ff] to-[#dcfce7] text-[#3e5f83] shadow-[0_14px_30px_-22px_rgba(55,83,60,.8)] ring-1 ring-white/80">
            <Newspaper className="h-[18px] w-[18px]" strokeWidth={1.6} />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#5da341]" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[#142016]">Live environmental news</h3>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#cbe8a5] bg-[#eefbdc] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#3f7d2a]">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-[#5da341]" /> Live
              </span>
              {feed.stale ? (
                <span className="rounded-full border border-[#eddeae] bg-[#fdf5df] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-[#8a6710]">
                  Cached
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[10px] text-[#66766b]">
              {feed.sources.map((source) => source.name).join(' · ')} · public RSS feeds · updated {timeAgo(feed.fetchedAt)}
              {error ? ' · refresh failed, showing the last loaded stories' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href={feed.sources[0]?.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-8 items-center gap-1 rounded-full border border-[#d5e0d1] bg-white/70 px-3 text-[10px] font-semibold text-[#3f5045] transition hover:border-[#bfd0b9] hover:bg-white"
          >
            Open feed <ArrowUpRight className="h-3 w-3" />
          </a>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            aria-label="Refresh live news"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d5e0d1] bg-white/70 text-[#5f7065] transition hover:bg-white hover:text-[#142016] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid gap-4 px-4 pb-4 lg:grid-cols-12 lg:px-5 lg:pb-5">
        <a
          href={feature.url}
          target="_blank"
          rel="noreferrer noopener"
          className="group relative flex min-h-[330px] flex-col justify-end overflow-hidden rounded-[22px] border border-white/60 p-5 lg:col-span-7"
        >
          <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_85%_0%,#dce9fb_0%,#e7e2f8_38%,#dcecd6_72%,#c9e0c4_100%)]" />
          <Newspaper className="absolute -right-4 top-5 h-40 w-40 text-white/45" strokeWidth={0.7} aria-hidden />
          {feature.imageUrl ? (
            <img
              src={feature.imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={hideBrokenImage}
              className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.03]"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0c1c13]/95 via-[#0c1c13]/38 to-[#0c1c13]/5" />

          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-[#12251a]/35 px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur-md">
              <Rss className="h-3 w-3" /> {feature.topic}
            </span>
            <span className="rounded-full border border-white/25 bg-[#12251a]/30 px-2.5 py-1 text-[9px] font-medium text-white/90 backdrop-blur-md">
              {timeAgo(feature.publishedAt)}
            </span>
          </div>

          <div className="relative">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/65">{feature.source}</p>
            <h4 className="display mt-2 text-[22px] font-semibold leading-[1.12] tracking-[-0.035em] text-white sm:text-[26px]">
              {feature.title}
            </h4>
            {feature.summary ? (
              <p className="mt-2 line-clamp-2 max-w-[54ch] text-[11px] leading-relaxed text-white/70">{feature.summary}</p>
            ) : null}
            <span className="mt-4 inline-flex items-center gap-1 text-[10px] font-semibold text-[#c9f0a2]">
              Read full story
              <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </span>
          </div>
        </a>

        <div className="flex min-h-0 flex-col lg:col-span-5">
          <div className="flex items-center justify-between px-1 pb-2">
            <DataLabel>Latest headlines</DataLabel>
            <span className="text-[9px] uppercase tracking-[0.1em] text-[#7a8b7e]">{rest.length} stories</span>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden rounded-[20px] border border-white/80 bg-white/50">
            {rest.map((item, index) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                className={`group flex flex-1 items-center gap-3 px-3 py-2.5 transition hover:bg-white/75 ${
                  index > 0 ? 'border-t border-dashed border-[#e1e9dd]' : ''
                }`}
              >
                <Thumb item={item} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[8.5px] font-semibold uppercase tracking-[0.1em] text-[#7a8b7e]">
                    {item.source} <span className="text-[#b3c0b6]">·</span> {timeAgo(item.publishedAt)}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[11px] font-medium leading-snug text-[#223328]">{item.title}</span>
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[#a9b7ac] transition group-hover:text-[#3f7d2a]" />
              </a>
            ))}
            {rest.length === 0 ? (
              <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-[10px] text-[#66766b]">
                No further headlines in this refresh.
              </p>
            ) : null}
          </div>

          <p className="mt-2 flex items-start gap-1.5 px-1 text-[9px] leading-relaxed text-[#7a8b7e]">
            <Clock3 className="mt-0.5 h-3 w-3 shrink-0" />
            Headlines link to the original publisher. Feeds refresh every 10 minutes.
          </p>
        </div>
      </div>
    </Card>
  );
}
