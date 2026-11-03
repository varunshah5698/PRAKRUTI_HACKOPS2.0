import { describe, expect, it } from 'vitest';
import { SAVED_NEWS_LIMIT, toggleSavedNews, type NewsItem, type SavedNewsItem } from './news';

function story(id: string): NewsItem {
  return {
    id,
    title: `Story ${id}`,
    url: `https://example.com/${id}`,
    summary: '',
    imageUrl: null,
    source: 'Test wire',
    topic: 'Mumbai',
    publishedAt: null,
  };
}

describe('saved news', () => {
  it('adds newest first and removes on a second toggle', () => {
    const first = toggleSavedNews([], story('a'), '2026-11-03T10:00:00.000Z');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: 'a', savedAt: '2026-11-03T10:00:00.000Z' });

    const second = toggleSavedNews(first, story('b'), '2026-11-03T10:05:00.000Z');
    expect(second.map((item) => item.id)).toEqual(['b', 'a']);

    const removed = toggleSavedNews(second, story('a'));
    expect(removed.map((item) => item.id)).toEqual(['b']);
  });

  it('caps the shelf at the newest saved stories', () => {
    let saved: SavedNewsItem[] = [];
    for (let index = 0; index < SAVED_NEWS_LIMIT + 2; index += 1) {
      saved = toggleSavedNews(saved, story(String(index)), new Date(2026, 10, 3, 10, index).toISOString());
    }
    expect(saved).toHaveLength(SAVED_NEWS_LIMIT);
    expect(saved[0].id).toBe(String(SAVED_NEWS_LIMIT + 1));
    expect(saved.at(-1)?.id).toBe('2');
  });
});
