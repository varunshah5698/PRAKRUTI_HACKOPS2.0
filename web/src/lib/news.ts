import { useCallback, useState } from 'react';

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

export interface NewsFeed {
  fetchedAt: string;
  stale: boolean;
  sources: Array<{ name: string; url: string; topic: string }>;
  items: NewsItem[];
}

export interface SavedNewsItem extends NewsItem {
  savedAt: string;
}

const STORAGE_KEY = 'prakriti.saved-news.v1';
export const SAVED_NEWS_LIMIT = 50;

function isSavedNewsItem(value: unknown): value is SavedNewsItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SavedNewsItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.url === 'string' &&
    typeof item.source === 'string' &&
    typeof item.savedAt === 'string'
  );
}

export function readSavedNews(): SavedNewsItem[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSavedNewsItem).slice(0, SAVED_NEWS_LIMIT) : [];
  } catch {
    return [];
  }
}

export function toggleSavedNews(current: SavedNewsItem[], item: NewsItem, savedAt = new Date().toISOString()): SavedNewsItem[] {
  if (current.some((entry) => entry.id === item.id)) return current.filter((entry) => entry.id !== item.id);
  return [{ ...item, savedAt }, ...current].slice(0, SAVED_NEWS_LIMIT);
}

/** Saved stories live in this browser only; no account or server round-trip. */
export function useSavedNews() {
  const [saved, setSaved] = useState<SavedNewsItem[]>(readSavedNews);

  const toggle = useCallback((item: NewsItem) => {
    setSaved((current) => {
      const next = toggleSavedNews(current, item);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage can be full or disabled; this session still reflects the change.
      }
      return next;
    });
  }, []);

  const isSaved = useCallback((id: string) => saved.some((entry) => entry.id === id), [saved]);

  return { saved, toggle, isSaved };
}
