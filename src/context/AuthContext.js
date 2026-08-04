import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import { trackRegistration } from '../services/analyticsTracker.js';

const AuthCtx = createContext(null);
export function useAuth() { return useContext(AuthCtx); }

function clearSupabaseAuthStorage() {
  if (typeof window === 'undefined') return;

  const shouldRemove = (key) =>
    key === 'supabase.auth.token' ||
    key.startsWith('sb-') ||
    key.includes('supabase') ||
    key.includes('auth-token');

  [window.localStorage, window.sessionStorage].forEach((storage) => {
    if (!storage) return;
    try {
      Object.keys(storage)
        .filter(shouldRemove)
        .forEach((key) => storage.removeItem(key));
    } catch (_error) {
      // Ignore storage access errors so logout can still finish.
    }
  });
}

async function clearNativeIdentity() {
  await Promise.allSettled([
    window.secureStore?.clearIdentity?.(),
    window.secureStore?.setCurrentUser?.(null),
    window.sessionStore?.clear?.(),
  ]);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Safety valve: never stay stuck on the loading screen for more than 6 seconds.
    const safetyTimer = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 6000);

    const init = async () => {
      // NOTE: The Supabase ping was removed — it was blocking init() whenever
      // Supabase was slow, causing the app to hang on "Restoring your session".
      // getSession() is sufficient to restore auth state from local storage.

      const { data } = await supabase.auth.getSession();

      if (data?.session?.user) {
        const u = data.session.user;
        setUser(u);
        // Keep electron-store userId in sync with the live Supabase session
        window.secureStore?.setCurrentUser?.(u.id)?.catch?.(() => {});
        // Load profile in background — don't await so auth resolves immediately,
        // then profile arrives and triggers a re-render once available.
        loadProfile(u.id).catch((e) =>
          console.warn('[AuthContext] loadProfile error:', e?.message)
        );
      } else {
        // No valid Supabase session — wipe any stale local identity immediately
        clearSupabaseAuthStorage();
        clearNativeIdentity();
      }

      if (mounted) {
        setLoading(false);
        clearTimeout(safetyTimer);
      }
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const u = session.user;
        setUser(u);
        window.secureStore?.setCurrentUser?.(u.id)?.catch?.(() => {});

        // For OAuth sign-ins, ensure a profile row exists (first-time Google login)
        if (event === 'SIGNED_IN') {
          await ensureProfile(u);
        }

        await loadProfile(u.id);
      } else {
        setUser(null);
        setProfile(null);
        clearSupabaseAuthStorage();
        clearNativeIdentity();
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      listener.subscription.unsubscribe();
    };
  }, []);

  const loadProfile = async (userId) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (data) {
      setProfile(data);
    } else if (error) {
      console.warn('[AuthContext] loadProfile error:', error.message);
    } else {
      // Profile row deleted from Supabase — force full sign-out immediately
      console.warn('[AuthContext] Profile not found — forcing sign-out');
      setUser(null);
      setProfile(null);
      clearSupabaseAuthStorage();
      clearNativeIdentity();
      supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  };

  /**
   * Ensure a profile row exists for OAuth users signing in for the first time.
   * Uses upsert so it's safe to call on every sign-in — existing rows are untouched.
   */
  const ensureProfile = async (u) => {
    try {
      const meta = u.user_metadata || {};
      const fullName = meta.full_name || meta.name || '';
      const email = u.email || meta.email || '';
      const avatarUrl = meta.avatar_url || meta.picture || null;

      await supabase.from('profiles').upsert(
        {
          id: u.id,
          full_name: fullName,
          email,
          avatar_url: avatarUrl,
          subscription_plan: 'free',
        },
        { onConflict: 'id', ignoreDuplicates: true }
      );

      // Track registration for new OAuth users
      const source = u.app_metadata?.provider || 'google';
      trackRegistration(u.id, source).catch((err) =>
        console.warn('[AuthContext] Analytics tracking failed:', err)
      );
    } catch (err) {
      console.warn('[AuthContext] ensureProfile error:', err?.message);
    }
  };

  const login = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const register = useCallback(async (email, password, name, { termsAccepted = false } = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });

    if (error) throw error;

    if (data?.user?.id) {
      await supabase.from('profiles').upsert(
        {
          id: data.user.id,
          full_name: name,
          email,
          subscription_plan: 'free',
          terms_accepted_at: termsAccepted ? new Date().toISOString() : null,
        },
        { onConflict: 'id' }
      );

      // Only track registration analytics when the operator has explicitly
      // accepted the Terms of Service and Privacy Policy (GDPR Art. 6/7).
      if (termsAccepted) {
        const source = new URLSearchParams(window.location.search).get('source') || 'website';
        const utmSource = new URLSearchParams(window.location.search).get('utm_source');
        trackRegistration(data.user.id, source, utmSource).catch(err =>
          console.warn('[AuthContext] Analytics tracking failed:', err)
        );
      }
    }
  }, []);

  /**
   * Sign in with Google via Supabase OAuth.
   * Opens a popup/redirect to Google's consent screen.
   * On success, onAuthStateChange fires and sets the user.
   */
  const loginWithGoogle = useCallback(async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
        skipBrowserRedirect: true,
      },
    });
    if (error) throw error;

    if (data?.url) {
      if (window.electron?.invoke) {
        const result = await window.electron.invoke('auth:oauth-popup', data.url);
        if (result?.access_token && result?.refresh_token) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: result.access_token,
            refresh_token: result.refresh_token,
          });
          if (sessionError) throw sessionError;
        } else if (result?.error) {
          throw new Error(result.error);
        }
      } else {
        window.location.href = data.url;
      }
    }
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    setProfile(null);
    clearSupabaseAuthStorage();
    await clearNativeIdentity();

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('[AuthContext] signOut error (state already cleared):', e.message);
    }

    clearSupabaseAuthStorage();
    await clearNativeIdentity();
  }, []);

  const sendPasswordReset = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  };

  const value = {
    user,
    profile,
    loading,
    login,
    loginWithGoogle,
    register,
    logout,
    sendPasswordReset,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}