import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAppState } from "./AppStateContext";

/**
 * Auth context for Supabase session + user.
 * Keeps the session in sync via onAuthStateChange and exposes a signOut helper.
 *
 * NOTE:
 * - Notification system has been removed from the app (UI + logic).
 * - We still fully reset app state on SIGNED_OUT and force a reload on signOut()
 *   to prevent cross-user "ghost" state.
 */

const AuthContext = createContext(null);

// PUBLIC_INTERFACE
export function AuthProvider({ children }) {
  /** Provides { session, user, loading, signOut } to descendants. */
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const { resetAll } = useAppState();

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

      // On SIGNED_OUT, clear state to avoid ghost UI across users.
      if (event === "SIGNED_OUT") {
        resetAll();
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, [resetAll]);

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
         * - Clear all local state to eliminate stale memory.
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
