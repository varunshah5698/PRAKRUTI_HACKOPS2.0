import { create } from 'zustand';
import { api, ApiError } from '../lib/api';

const USER_CACHE_KEY = 'ep:user';

function readCachedUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function cacheUser(user: AuthUser) {
  try {
    sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  } catch {
    // Storage may be unavailable; the httpOnly cookie remains the source of truth.
  }
}

function clearCachedUser() {
  try {
    sessionStorage.removeItem(USER_CACHE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'PUBLIC' | 'FIELD_OFFICER' | 'ENVIRONMENTAL_ANALYST' | 'AUTHORITY_ADMIN' | 'SYSTEM_ADMIN';
  accountStatus: string;
  localityId: string | null;
  localityName: string | null;
  department: string | null;
  designation: string | null;
  jurisdiction: string | null;
  requestedRole: string | null;
  onboardingCompleted?: boolean;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  lastLoginAt?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  preferences: Record<string, unknown> | null;
  loading: boolean;
  initialized: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<AuthUser>;
  logout: () => Promise<void>;
  loadMe: () => Promise<void>;
  refreshPreferences: () => Promise<void>;
  isAuthority: () => boolean;
  can: (roles: string[]) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  preferences: null,
  loading: false,
  initialized: false,
  login: async (email, password, rememberMe = false) => {
    set({ loading: true });
    try {
      const result = await api.post<{ user: AuthUser }>('/auth/login', { email, password, rememberMe });
      cacheUser(result.user);
      set({ user: result.user });
      await get().loadMe();
      return result.user;
    } finally {
      set({ loading: false });
    }
  },
  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clearCachedUser();
      set({ user: null, preferences: null, initialized: true });
    }
  },
  loadMe: async () => {
    try {
      const result = await api.get<{ user: AuthUser | null; preferences: Record<string, unknown> | null }>('/auth/session');
      if (!result.user) {
        clearCachedUser();
        set({ user: null, preferences: null, initialized: true });
        return;
      }
      cacheUser(result.user);
      set({ user: result.user, preferences: result.preferences, initialized: true });
    } catch (error) {
      // A 5xx during a restart is not a logout. Keep the last verified user so
      // the session survives; only a 401/403 clears it.
      const unauthorized = error instanceof ApiError && (error.status === 401 || error.status === 403);
      const cached = unauthorized ? null : readCachedUser();
      if (cached) {
        set({ user: cached, initialized: true });
        return;
      }
      clearCachedUser();
      set({ user: null, preferences: null, initialized: true });
    }
  },
  refreshPreferences: async () => {
    try {
      const result = await api.get<{ preferences: Record<string, unknown> | null }>('/notifications/preferences');
      set({ preferences: result.preferences });
    } catch {
      // Keep existing preferences on error.
    }
  },
  isAuthority: () => {
    const role = get().user?.role;
    return Boolean(role && ['FIELD_OFFICER', 'ENVIRONMENTAL_ANALYST', 'AUTHORITY_ADMIN', 'SYSTEM_ADMIN'].includes(role));
  },
  can: (roles) => {
    const role = get().user?.role;
    return Boolean(role && roles.includes(role));
  },
}));
