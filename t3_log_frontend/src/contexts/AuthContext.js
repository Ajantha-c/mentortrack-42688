import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAppState } from "./AppStateContext";

/**
 * Auth context for Supabase session + user.
 * Keeps the session in sync via onAuthStateChange and exposes a signOut helper.
 *
 * Ghost notification fix:
 * - On SIGNED_OUT: clear notification-related state (and other stale app state).
 * - On signOut(): reset global state and force a full browser reload to fully purge in-memory state.
 */

const AuthContext = createContext(null);

// PUBLIC_INTERFACE
export function AuthProvider({ children }) {
  /** Provides { session, user, loading, signOut } to descendants. */
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const { resetAll, setNotifications } = useAppState();

  useEffect(() => {
    let mounted = true;

    async function loadInitialSession() {
      setLoading(true);
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) {
        // eslint-disable-next-line no-console
        console.error("[auth] getSession error:", error);
      }
      setSession(data?.session ?? null);
      setLoading(false);
    }

    loadInitialSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      // Keep auth session in sync
      setSession(newSession ?? null);
      setLoading(false);

      // Requirement: if SIGNED_OUT, clear notification list explicitly (and other state).
      if (event === "SIGNED_OUT") {
        setNotifications([]); // explicit per requirement
        resetAll(); // also clear tasks/profile/etc to avoid ghost UI
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, [resetAll, setNotifications]);

  const value = useMemo(() => {
    const user = session?.user ?? null;

    return {
      session,
      user,
      loading,
      // PUBLIC_INTERFACE
      async signOut() {
        /**
         * Signs the user out via Supabase auth.
         *
         * Requirement:
         * - Clear all local state (tasks, profiles, notifications) to eliminate stale memory.
         * - Force a full browser refresh after sign-out to destroy any remaining background memory.
         */
        resetAll();
        await supabase.auth.signOut();

        // Force full reload to purge any leftover in-memory state / subscriptions.
        window.location.href = "/login";
      },
    };
  }, [session, loading, resetAll]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// PUBLIC_INTERFACE
export function useAuth() {
  /** Hook to access the AuthProvider value. */
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider />");
  }
  return ctx;
}

export default AuthContext;
