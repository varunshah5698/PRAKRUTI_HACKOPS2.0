import { create } from 'zustand';
import { api } from '../lib/api';

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
      set({ user: result.user });
      await get().loadMe();
      return result.user;
    } finally {
      set({ loading: false });
    }
  },
  logout: async () => {
    await api.post('/auth/logout');
    set({ user: null, preferences: null, initialized: true });
  },
  loadMe: async () => {
    try {
      const result = await api.get<{ user: AuthUser | null; preferences: Record<string, unknown> | null }>('/auth/session');
      if (!result.user) {
        set({ user: null, preferences: null, initialized: true });
        return;
      }
      set({ user: result.user, preferences: result.preferences, initialized: true });
    } catch {
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
