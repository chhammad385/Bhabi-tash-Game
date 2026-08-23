import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile } from '../types/game';
import { updateSocketAuth, disconnectSocket } from '../lib/socket';
import { apiFetch } from '../lib/api';

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  /** True when nobody is signed in. Playing requires a real account. */
  isGuest: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, password: string, displayName: string, avatar: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  updateProfile: (displayName: string, avatar: string) => Promise<{ success: boolean; error?: string }>;
  setGuestProfile: (displayName: string, avatar: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'bhabhi_auth_token';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);

  // A user is a "guest" purely in the sense that they are not signed in.
  // There is no client-generated identity any more: the server derives who
  // you are exclusively from the verified JWT, so a browser can no longer
  // claim to be another player.
  const isGuest = !user;

  useEffect(() => {
    async function initAuth() {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (savedToken) {
        const { ok, data } = await apiFetch<{ user: UserProfile }>('/api/auth/me', {
          token: savedToken,
        });
        if (ok && data?.user) {
          setUser(data.user);
          setToken(savedToken);
          setIsLoading(false);
          return;
        }
        // Token rejected or expired — clear it rather than keeping a dead session.
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      }
      setUser(null);
      setIsLoading(false);
    }

    initAuth();
  }, []);

  const applySession = (newToken: string, newUser: UserProfile) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
    updateSocketAuth(newToken);
  };

  const login = async (username: string, password: string) => {
    const { ok, data } = await apiFetch<any>('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: { username, password },
    });
    if (!ok) return { success: false, error: data?.error || 'Login failed' };
    applySession(data.token, data.user);
    return { success: true };
  };

  const register = async (username: string, password: string, displayName: string, avatar: string) => {
    const { ok, data } = await apiFetch<any>('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: { username, password, displayName, avatar },
    });
    if (!ok) return { success: false, error: data?.error || 'Registration failed' };
    applySession(data.token, data.user);
    return { success: true };
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    // Drop the authenticated socket entirely; an unauthenticated one is
    // rejected by the server anyway.
    disconnectSocket();
  };

  const updateProfile = async (displayName: string, avatar: string) => {
    if (!token) return { success: false, error: 'You must be signed in.' };

    const { ok, data } = await apiFetch<any>('/api/auth/profile', {
      method: 'PATCH',
      body: { displayName, avatar },
    });
    if (!ok) return { success: false, error: data?.error || 'Update failed' };
    setUser(data.user);
    return { success: true };
  };

  /**
   * Kept for the profile panel when signed out. Purely a local display
   * preference — it is never sent to the server and grants no identity.
   */
  const setGuestProfile = (displayName: string, avatar: string) => {
    localStorage.setItem('bhabhi_pref_name', displayName);
    localStorage.setItem('bhabhi_pref_avatar', avatar);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isGuest,
        login,
        register,
        logout,
        updateProfile,
        setGuestProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
