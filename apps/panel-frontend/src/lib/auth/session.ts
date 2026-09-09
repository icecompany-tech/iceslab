import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AdminInfo {
  id: string;
  username: string;
  role: string;
}

interface AuthState {
  token: string | null;
  admin: AdminInfo | null;
  setSession: (token: string, admin: AdminInfo) => void;
  clearSession: () => void;
}

/**
 * Zustand store for the JWT and admin info, persisted to localStorage. The
 * Axios interceptor in `lib/api.ts` reads `token` from this store on every
 * request, there's no other source of truth.
 */
export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      admin: null,
      setSession: (token, admin) => set({ token, admin }),
      clearSession: () => set({ token: null, admin: null }),
    }),
    { name: 'iceslab-auth' },
  ),
);
