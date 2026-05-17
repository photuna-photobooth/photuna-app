import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabase.js';

const AuthCtx = createContext(null);
export function useAuth() { return useContext(AuthCtx); }

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
        window.secureStore?.clearIdentity?.()?.catch?.(() => {});
        window.secureStore?.setCurrentUser?.(null)?.catch?.(() => {});
      }

      if (mounted) {
        setLoading(false);
        clearTimeout(safetyTimer);
      }
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_, session) => {
      if (session?.user) {
        const u = session.user;
        setUser(u);
        window.secureStore?.setCurrentUser?.(u.id)?.catch?.(() => {});
        await loadProfile(u.id);
      } else {
        setUser(null);
        setProfile(null);
        window.secureStore?.clearIdentity?.()?.catch?.(() => {});
        window.secureStore?.setCurrentUser?.(null)?.catch?.(() => {});
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
      window.secureStore?.clearIdentity?.()?.catch?.(() => {});
      window.secureStore?.setCurrentUser?.(null)?.catch?.(() => {});
      supabase.auth.signOut().catch(() => {});
    }
  };

  const login = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const register = useCallback(async (email, password, name) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });

    if (error) throw error;

    if (data?.user?.id) {
      await supabase.from('profiles').upsert(
        { id: data.user.id, full_name: name, email, subscription_plan: 'free' },
        { onConflict: 'id' }
      );
    }
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    setProfile(null);

    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('[AuthContext] signOut error (state already cleared):', e.message);
    }

    window.secureStore?.clearIdentity?.()?.catch?.(() => {});
    window.secureStore?.setCurrentUser?.(null)?.catch?.(() => {});
    window.sessionStore?.clear?.()?.catch?.(() => {});
  }, []);

  const sendPasswordReset = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  };

  const value = { user, profile, loading, login, register, logout, sendPasswordReset };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
