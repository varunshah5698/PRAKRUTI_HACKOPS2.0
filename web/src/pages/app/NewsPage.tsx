import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  Clock3,
  ExternalLink,
  Leaf,
  Newspaper,
  Radio,
  RefreshCw,
  Rss,
  Signal,
} from 'lucide-react';
import { Button, Card, CardHeader, CardTitle, DataLabel, EmptyState } from '../../components/ui';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useSavedNews, type NewsFeed, type NewsItem, type SavedNewsItem } from '../../lib/news';

const POLL_MS = 5 * 60_000;

function hideBrokenImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none';
}

function thumbUrl(url: string): string {
  // The Hindu CDN offers a small variant. Guardian URLs are signed, so their
  // width cannot be rewritten without breaking the signature.
  return url.replace('/LANDSCAPE_1200/', '/LANDSCAPE_215/');
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'publisher';
  }
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function LivePill({ stale, failed }: { stale?: boolean; failed?: boolean }) {
  const cached = stale || failed;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] ${
        cached
          ? 'border-[#eddeae] bg-[#fdf5df] text-[#8a6710]'
          : 'border-[#cbe8a5] bg-[#eefbdc] text-[#3f7d2a]'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cached ? 'bg-[#c69218]' : 'animate-pulse-soft bg-[#5da341]'}`} />
      {failed ? 'Reconnecting' : stale ? 'Cached wire' : 'Live wire'}
    </span>
  );
}

function StoryArt({ item, large = false }: { item: NewsItem; large?: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_88%_0%,#d9e6fa_0%,#e6e1f7_38%,#dcebd6_72%,#c9e0c4_100%)]" />
      <Newspaper
        className={`absolute -right-4 -top-5 text-[#223328]/10 ${large ? 'h-48 w-48' : 'h-28 w-28'}`}
        strokeWidth={0.6}
      />
      {item.imageUrl ? (
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={hideBrokenImage}
          className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]"
        />
      ) : null}
    </div>
  );
}

function Thumb({ item }: { item: NewsItem }) {
  return (
    <span className="relative flex h-[58px] w-[66px] shrink-0 items-center justify-center overflow-hidden rounded-[15px] bg-[radial-gradient(120%_120%_at_20%_0%,#e7eefb_0%,#e6e4f7_46%,#dcebd5_100%)] ring-1 ring-white/80">
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

function SaveButton({
  item,
  saved,
  onToggle,
  tone = 'overlay',
  className = '',
}: {
  item: NewsItem;
  saved: boolean;
  onToggle: (item: NewsItem) => void;
  tone?: 'overlay' | 'plain';
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(item)}
      aria-pressed={saved}
      aria-label={saved ? `Remove “${item.title}” from saved stories` : `Save “${item.title}” for later`}
      title={saved ? 'Remove from saved' : 'Save for later'}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fc47a] ${
        saved
          ? 'border-[#cbe8a5] bg-[#eefbdc] text-[#3f7d2a]'
          : tone === 'plain'
            ? 'border-[#d5e0d1] bg-white/70 text-[#7a8b7e] hover:border-[#bfd0b9] hover:text-[#142016]'
            : 'border-white/35 bg-[#12251a]/45 text-white hover:bg-[#12251a]/70'
      } ${className}`}
    >
      <Bookmark className={`h-3.5 w-3.5 ${saved ? 'fill-current' : ''}`} />
    </button>
  );
}

function StoryCard({ item, saved, onToggle }: { item: NewsItem; saved: boolean; onToggle: (item: NewsItem) => void }) {
  return (
    <div className="group glass-card relative flex flex-col overflow-hidden rounded-[24px] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_50px_-36px_rgba(23,42,29,.55)]">
      <a href={item.url} target="_blank" rel="noreferrer noopener" className="flex flex-1 flex-col">
        <div className="relative h-40 overflow-hidden">
          <StoryArt item={item} />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0c1c13]/35 to-transparent" />
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/30 bg-[#12251a]/40 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur-md">
            {item.topic}
          </span>
        </div>
        <div className="flex flex-1 flex-col p-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#7a8b7e]">
            {item.source} <span className="text-[#b3c0b6]">·</span> {timeAgo(item.publishedAt)}
          </p>
          <h3 className="mt-1.5 line-clamp-2 text-[14px] font-semibold leading-snug text-[#1b2a1f]">{item.title}</h3>
          {item.summary ? <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-[#66766b]">{item.summary}</p> : null}
          <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[10px] font-semibold text-[#3f7d2a]">
            Read story
            <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </span>
        </div>
      </a>
      <SaveButton item={item} saved={saved} onToggle={onToggle} className="absolute right-3 top-3 z-10" />
    </div>
  );
}

function SavedStories({
  saved,
  onToggle,
  onBrowse,
}: {
  saved: SavedNewsItem[];
  onToggle: (item: NewsItem) => void;
  onBrowse?: () => void;
}) {
  if (saved.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No saved stories yet"
          description="Tap the bookmark on any story to keep it here. Saved stories stay in this browser on this device."
          icon={<Bookmark className="h-6 w-6" />}
          action={onBrowse ? <Button variant="outline" onClick={onBrowse}>Browse the wire</Button> : undefined}
        />
      </Card>
    );
  }

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between px-1">
        <div>
          <DataLabel>Saved stories</DataLabel>
          <p className="mt-1 text-[10px] text-[#66766b]">Kept in this browser on this device</p>
        </div>
        <span className="text-[9px] uppercase tracking-[0.1em] text-[#7a8b7e]">{saved.length} saved</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {saved.map((item) => (
          <StoryCard key={item.id} item={item} saved onToggle={onToggle} />
        ))}
      </div>
    </section>
  );
}

function NewsSkeleton() {
  return (
    <div className="space-y-4">
      <Card className="p-6 lg:p-8">
        <div className="h-3 w-44 animate-pulse rounded-full bg-[#e5ece1]" />
        <div className="mt-4 h-9 w-2/3 animate-pulse rounded-2xl bg-[#e5ece1]" />
        <div className="mt-3 h-2.5 w-1/2 animate-pulse rounded-full bg-[#eef2ea]" />
        <div className="mt-6 h-8 w-full animate-pulse rounded-full bg-[#eef2ea]" />
      </Card>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-h-[420px] animate-pulse rounded-[26px] bg-[#e9f0e5] xl:col-span-8" />
        <div className="space-y-3 xl:col-span-4">
          {[0, 1, 2].map((key) => (
            <div key={key} className="h-[92px] animate-pulse rounded-[22px] bg-[#eef2ea]" />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The environmental newsroom. Server-proxied RSS keeps publisher CORS and rate
 * limits out of the browser; the page refreshes itself every five minutes.
 */
export function NewsPage() {
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<'wire' | 'saved'>('wire');
  const { saved, toggle, isSaved } = useSavedNews();

  const load = useCallback((quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    api
      .get<NewsFeed>('/news')
      .then((result) => {
        setFeed(result);
        setError(null);
        setNow(Date.now());
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

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading && !feed) return <NewsSkeleton />;

  if (!feed) {
    return (
      <div className="space-y-4">
        <Card>
          <EmptyState
            title="The newsroom is offline"
            description={error ?? 'The publisher feeds could not be reached. This page retries automatically.'}
            icon={<Newspaper className="h-6 w-6" />}
            action={<Button variant="lime" onClick={() => load()} disabled={refreshing}>Try again</Button>}
          />
        </Card>
        {saved.length > 0 ? <SavedStories saved={saved} onToggle={toggle} /> : null}
      </div>
    );
  }

  if (feed.items.length === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <EmptyState
            title="No fresh headlines yet"
            description="The feeds are reachable but have no recent environmental stories. The page checks again every five minutes."
            icon={<Rss className="h-6 w-6" />}
            action={<Button variant="outline" onClick={() => load(true)} disabled={refreshing}>Refresh now</Button>}
          />
        </Card>
        {saved.length > 0 ? <SavedStories saved={saved} onToggle={toggle} /> : null}
      </div>
    );
  }

  const [feature, ...remaining] = feed.items;
  const latest = remaining.slice(0, 3);
  const more = remaining.slice(3);
  const nextRefreshMs = Math.max(0, POLL_MS - (now - new Date(feed.fetchedAt).getTime()));

  return (
    <div className="space-y-4 pb-2">
      {/* Masthead */}
      <Card className="relative overflow-hidden p-5 lg:p-7">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute inset-0 bg-[radial-gradient(130%_160%_at_100%_0%,#d7e7fb_0%,#e6e0f8_42%,#dcf0cf_78%,#f4faee_100%)]" />
          <span className="absolute -right-24 -top-32 h-[24rem] w-[24rem] rounded-full border border-white/60" />
          <span className="absolute -right-10 -top-16 h-[15rem] w-[15rem] rounded-full border border-white/70" />
          <span className="absolute right-[10%] top-[18%] h-56 w-56 rounded-full bg-white/50 blur-3xl" />
          <Newspaper className="absolute -bottom-10 right-6 h-56 w-56 rotate-[-8deg] text-white/30" strokeWidth={0.5} />
        </div>

        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/60 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#3e5f83] backdrop-blur">
                <Leaf className="h-3 w-3" /> Prakriti environmental desk
              </span>
              <LivePill stale={feed.stale} failed={Boolean(error)} />
            </div>
            <h1 className="display mt-3 text-[30px] font-bold leading-[1.02] tracking-[-0.045em] text-[#102016] sm:text-[38px] lg:text-[44px]">
              The environmental newsroom
            </h1>
            <p className="mt-2.5 max-w-2xl text-[12px] leading-relaxed text-[#4c5f52] sm:text-[13px]">
              Live headlines on Mumbai&rsquo;s air, water, waste and climate &mdash; gathered from publisher RSS feeds and refreshed
              on their own. Every story opens at the original newsroom.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] font-medium text-[#4c5f52]">
              <span className="inline-flex items-center gap-1.5"><Newspaper className="h-3.5 w-3.5 text-[#4e9b3f]" /> {feed.items.length} stories</span>
              <span className="inline-flex items-center gap-1.5"><Signal className="h-3.5 w-3.5 text-[#4e9b3f]" /> {feed.sources.length} live sources</span>
              <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-[#4e9b3f]" /> Updated {timeAgo(feed.fetchedAt)}</span>
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 text-[#4e9b3f] ${refreshing ? 'animate-spin' : ''}`} />
                Next refresh in {countdown(nextRefreshMs)}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Button variant="ink" size="sm" onClick={() => load(true)} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing' : 'Refresh wire'}
            </Button>
            <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-[#66766b]">Auto-refresh every 5 min</p>
          </div>
        </div>

        {/* Live ticker */}
        <a
          href={(remaining[0] ?? feature).url}
          target="_blank"
          rel="noreferrer noopener"
          className="group relative mt-6 flex items-center gap-2 overflow-hidden rounded-full border border-white/80 bg-white/60 py-1.5 pl-1.5 pr-3 backdrop-blur transition hover:bg-white/80"
        >
          <span className="z-10 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#142016] px-2.5 py-1 text-[8px] font-bold uppercase tracking-[0.16em] text-[#d3f8a1]">
            <Radio className="h-3 w-3" /> Latest wire
          </span>
          <span className="hidden shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#66766b] sm:inline">
            {(remaining[0] ?? feature).source}
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-[#34463a]">{(remaining[0] ?? feature).title}</span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[#7a8b7e] transition group-hover:text-[#3f7d2a]" />
        </a>
      </Card>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#eddeae] bg-[#fdf5df] px-4 py-2.5 text-[10px] text-[#8a6710]">
          <span>Refresh failed. Showing the last stories loaded from the publisher feeds.</span>
          <button type="button" onClick={() => load(true)} className="font-semibold underline underline-offset-2">Retry now</button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="inline-flex items-center gap-1 rounded-full border border-white/80 bg-white/60 p-1 shadow-pill backdrop-blur">
          <button
            type="button"
            onClick={() => setView('wire')}
            aria-pressed={view === 'wire'}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-semibold transition ${
              view === 'wire' ? 'bg-[#142016] text-white shadow-pill' : 'text-[#5f7065] hover:bg-white/70 hover:text-[#142016]'
            }`}
          >
            <Newspaper className="h-3.5 w-3.5" /> The wire
          </button>
          <button
            type="button"
            onClick={() => setView('saved')}
            aria-pressed={view === 'saved'}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-semibold transition ${
              view === 'saved' ? 'bg-[#142016] text-white shadow-pill' : 'text-[#5f7065] hover:bg-white/70 hover:text-[#142016]'
            }`}
          >
            <Bookmark className={`h-3.5 w-3.5 ${view === 'saved' ? 'fill-current' : ''}`} /> Saved
            {saved.length > 0 ? (
              <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${view === 'saved' ? 'bg-[#d3f8a1] text-[#25461c]' : 'bg-[#e4f5d8] text-[#2f6a24]'}`}>
                {saved.length}
              </span>
            ) : null}
          </button>
        </div>
        <p className="text-[9px] uppercase tracking-[0.12em] text-[#7a8b7e]">Saved stories stay in this browser</p>
      </div>

      {view === 'saved' ? (
        <SavedStories saved={saved} onToggle={toggle} onBrowse={() => setView('wire')} />
      ) : (
        <>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-8">
          {/* Lead story */}
          <div className="group relative">
            <a
              href={feature.url}
              target="_blank"
              rel="noreferrer noopener"
              className="relative flex min-h-[420px] flex-col justify-end overflow-hidden rounded-[26px] border border-white/60 p-5 shadow-[0_28px_60px_-42px_rgba(16,32,22,.7)] sm:min-h-[460px] sm:p-7"
            >
              <StoryArt item={feature} large />
              <div className="absolute inset-0 bg-gradient-to-t from-[#08180f]/95 via-[#0c1c13]/45 to-[#0c1c13]/5" />
              <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-4 pr-12 sm:p-5 sm:pr-16">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-[#12251a]/35 px-2.5 py-1 text-[8px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur-md">
                  <Rss className="h-3 w-3" /> {feature.topic}
                </span>
                <span className="rounded-full border border-white/25 bg-[#12251a]/30 px-2.5 py-1 text-[9px] font-medium text-white/90 backdrop-blur-md">
                  {timeAgo(feature.publishedAt)}
                </span>
              </div>
              <div className="relative">
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#c9f0a2]">Lead story</p>
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
                  {feature.source} <span className="text-white/30">·</span> {hostOf(feature.url)}
                </p>
                <h2 className="display mt-2 max-w-3xl text-[24px] font-semibold leading-[1.08] tracking-[-0.035em] text-white sm:text-[32px] lg:text-[34px]">
                  {feature.title}
                </h2>
                {feature.summary ? (
                  <p className="mt-2.5 line-clamp-2 max-w-[68ch] text-[11px] leading-relaxed text-white/70 sm:text-[12px]">{feature.summary}</p>
                ) : null}
                <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3.5 py-2 text-[10px] font-semibold text-white backdrop-blur-md transition group-hover:bg-white/20">
                  Read the full story
                  <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </span>
              </div>
            </a>
            <SaveButton
              item={feature}
              saved={isSaved(feature.id)}
              onToggle={toggle}
              className="absolute right-4 top-4 z-10 sm:right-5 sm:top-5"
            />
          </div>
        </div>

        <aside className="space-y-4 xl:col-span-4">
          <Card className="overflow-hidden">
            <CardHeader>
              <div>
                <CardTitle>Latest headlines</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">The wire, newest first</p>
              </div>
              <span className="rounded-full border border-[#cbe8a5] bg-[#eefbdc] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#3f7d2a]">Live</span>
            </CardHeader>
            <div className="divide-y divide-dashed divide-[#e1e9dd]">
              {latest.map((item, index) => (
                <div key={item.id} className="relative">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group flex items-center gap-3 py-3 pl-3.5 pr-12 transition hover:bg-white/70"
                  >
                    <span className="display w-5 shrink-0 text-[13px] font-semibold text-[#b3c0b6]">{String(index + 1).padStart(2, '0')}</span>
                    <Thumb item={item} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[8.5px] font-semibold uppercase tracking-[0.1em] text-[#7a8b7e]">
                        {item.source} <span className="text-[#b3c0b6]">·</span> {timeAgo(item.publishedAt)}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[11px] font-medium leading-snug text-[#223328]">{item.title}</span>
                    </span>
                  </a>
                  <SaveButton
                    item={item}
                    saved={isSaved(item.id)}
                    onToggle={toggle}
                    tone="plain"
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                  />
                </div>
              ))}
              {latest.length === 0 ? (
                <p className="px-4 py-8 text-center text-[10px] text-[#66766b]">The lead story is the only headline in this refresh.</p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Live sources</CardTitle>
                <p className="mt-1 text-[10px] text-[#66766b]">Public RSS from the publishers</p>
              </div>
              <Rss className="h-4 w-4 text-[#4e9b3f]" />
            </CardHeader>
            <div className="space-y-2 p-3.5">
              {feed.sources.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex items-center gap-3 rounded-2xl border border-white/80 bg-white/55 px-3 py-2.5 transition hover:border-[#cddcc8] hover:bg-white"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8f6e4] text-[#2f7d33]">
                    <Rss className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold text-[#223328]">{source.name}</span>
                    <span className="block text-[9px] text-[#7a8b7e]">{source.topic} · RSS feed</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#a9b7ac] transition group-hover:text-[#3f7d2a]" />
                </a>
              ))}
              <p className="flex items-start gap-1.5 px-1 pt-1 text-[9px] leading-relaxed text-[#7a8b7e]">
                <Clock3 className="mt-0.5 h-3 w-3 shrink-0" />
                The server caches each feed for five minutes. Refreshes stop if a publisher is unreachable and the last cached stories stay up.
              </p>
            </div>
          </Card>

          <div className="rounded-[22px] border border-[#d5e0d1] bg-[#f5f9f1]/80 p-4">
            <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#3f7d2a]">
              <Leaf className="h-3.5 w-3.5" /> How the wire works
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-[#66766b]">
              Headlines are pulled from publisher RSS through Prakriti&apos;s server, so the browser never hits the publishers
              directly. Summaries are the feeds&apos; own; article bodies are never copied.
            </p>
          </div>
        </aside>
      </div>

      {more.length > 0 ? (
        <section>
          <div className="mb-2.5 flex items-center justify-between px-1">
            <div>
              <DataLabel>More from the wire</DataLabel>
              <p className="mt-1 text-[10px] text-[#66766b]">Fresh reporting beyond the lead story</p>
            </div>
            <span className="text-[9px] uppercase tracking-[0.1em] text-[#7a8b7e]">{more.length} stories</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {more.map((item) => (
              <StoryCard key={item.id} item={item} saved={isSaved(item.id)} onToggle={toggle} />
            ))}
          </div>
        </section>
      ) : null}
        </>
      )}
    </div>
  );
}
