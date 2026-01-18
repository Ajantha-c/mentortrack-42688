import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Dedicated OAuth callback handler.
 *
 * Why this exists:
 * - After Supabase OAuth redirect, the browser may land on a URL containing:
 *   - hash tokens (#access_token=...) OR
 *   - PKCE code (?code=...) depending on provider/config.
 * - We must finalize/confirm the session WITHOUT navigating to a different SPA route
 *   (to avoid 404s in preview/static hosting environments).
 *
 * Behavior:
 * - Detect callback params in the URL.
 * - Ensure Supabase has a valid session (Supabase client uses detectSessionInUrl=true).
 * - If a callback is detected, show a minimal "Completing sign-in..." overlay while auth settles.
 * - Remove OAuth params from the URL (replaceState) so refresh/bookmarks don't re-trigger parsing.
 */
function AuthCallbackHandler({ children }) {
  const [handlingCallback, setHandlingCallback] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    const url = new URL(window.location.href);

    // Supabase may return:
    // - Implicit flow: access_token in hash
    // - PKCE flow: ?code=... in query
    // - Errors: ?error=... or #error=...
    const hasHash = window.location.hash && window.location.hash.length > 1;
    const hasQuery = url.search && url.search.length > 1;

    const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    const queryParams = url.searchParams;

    const isCallbackLike =
      hashParams.has("access_token") ||
      hashParams.has("refresh_token") ||
      hashParams.has("error") ||
      queryParams.has("code") ||
      queryParams.has("error") ||
      queryParams.has("error_description");

    async function finalizeIfNeeded() {
      if (!isCallbackLike) return;

      setHandlingCallback(true);
      setError(null);

      // If there is an explicit error in the callback, surface it.
      const err =
        queryParams.get("error_description") ||
        queryParams.get("error") ||
        hashParams.get("error_description") ||
        hashParams.get("error");

      if (err) {
        if (!mounted) return;
        setError(err);
        setHandlingCallback(false);
        // Still clean the URL so refresh doesn't keep showing the error state.
        window.history.replaceState({}, document.title, url.pathname);
        return;
      }

      // Supabase-js with detectSessionInUrl=true should parse and store session automatically.
      // We still call getSession() as a deterministic "settle point" before we clean URL.
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (!mounted) return;

      if (sessionError) {
        setError(sessionError.message || "Failed to complete sign-in.");
        setHandlingCallback(false);
        // Clean URL even on error to avoid repeated attempts on reload.
        window.history.replaceState({}, document.title, url.pathname);
        return;
      }

      // If session exists, we can safely remove callback params from URL.
      // This keeps the app on "/" (or whatever the current path is) and avoids extra routing.
      if (data?.session) {
        window.history.replaceState({}, document.title, url.pathname);
      } else {
        // No session was created; still clean URL.
        window.history.replaceState({}, document.title, url.pathname);
      }

      setHandlingCallback(false);
    }

    void finalizeIfNeeded();

    return () => {
      mounted = false;
    };
  }, []);

  if (!handlingCallback && !error) return children;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-full rounded-2xl border border-white/15 bg-white/5 p-8 shadow-glass backdrop-blur-xl">
          <h1 className="text-2xl font-bold">
            {error ? "Sign-in failed" : "Completing sign-in…"}
          </h1>

          {error ? (
            <p className="mt-3 text-sm text-red-100/90">{error}</p>
          ) : (
            <p className="mt-3 text-sm text-white/70">
              Please wait while we finish connecting your Google account.
            </p>
          )}

          {error ? (
            <button
              type="button"
              className="mt-6 inline-flex rounded-xl bg-orange-500 px-5 py-3 font-semibold text-black hover:bg-orange-400"
              onClick={() => {
                // Stay on "/" to preserve single-route structure and avoid 404s.
                window.location.href = "/";
              }}
            >
              Back to login
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default AuthCallbackHandler;
