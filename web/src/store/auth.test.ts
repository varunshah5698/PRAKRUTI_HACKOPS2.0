import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, get: vi.fn(), post: vi.fn() },
  };
});

import { ApiError, api } from '../lib/api';
import { useAuth, type AuthUser } from './auth';

const CACHE_KEY = 'ep:user';

const user: AuthUser = {
  id: 'u1',
  name: 'Test User',
  email: 'test@example.com',
  role: 'SYSTEM_ADMIN',
  accountStatus: 'ACTIVE',
  localityId: null,
  localityName: null,
  department: null,
  designation: null,
  jurisdiction: null,
  requestedRole: null,
};

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.mocked(api.get).mockReset();
  useAuth.setState({ user: null, preferences: null, initialized: false, loading: false });
});

describe('auth session cache', () => {
  it('keeps the cached user when the session check fails with a 500', async () => {
    storage.set(CACHE_KEY, JSON.stringify(user));
    vi.mocked(api.get).mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'boom'));

    await useAuth.getState().loadMe();

    expect(useAuth.getState().user).toEqual(user);
    expect(useAuth.getState().initialized).toBe(true);
  });

  it('clears the cached user on 401', async () => {
    storage.set(CACHE_KEY, JSON.stringify(user));
    vi.mocked(api.get).mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Authentication required.'));

    await useAuth.getState().loadMe();

    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().initialized).toBe(true);
    expect(storage.has(CACHE_KEY)).toBe(false);
  });

  it('caches the user after a successful session check', async () => {
    vi.mocked(api.get).mockResolvedValue({ user, preferences: null });

    await useAuth.getState().loadMe();

    expect(useAuth.getState().user).toEqual(user);
    expect(storage.get(CACHE_KEY)).toBe(JSON.stringify(user));
  });
});
