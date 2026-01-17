import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import "./index.css";
import App from "./App";
import {
  readPersistedRole,
  roleToDashboardPath,
  supabase,
} from "./lib/supabaseClient";

/**
 * Handles post-OAuth session establishment and redirects to the correct dashboard.
 * Supabase will parse the OAuth callback URL and set the session when detectSessionInUrl=true.
 */
function AuthCallbackHandler({ children }) {
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    async function maybeRedirectAfterAuth() {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (!isMounted) return;

      if (error) {
        // eslint-disable-next-line no-console
        console.error("[auth] getSession error:", error);
        return;
      }

      if (session) {
        const role = readPersistedRole();
        navigate(roleToDashboardPath(role), { replace: true });
      }
    }

    // Run on initial load (covers OAuth callback landing)
    maybeRedirectAfterAuth();

    // Also listen for future auth state transitions
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) return;
        const role = readPersistedRole();
        navigate(roleToDashboardPath(role), { replace: true });
      }
    );

    return () => {
      isMounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, [navigate]);

  return children;
}

function SimpleDashboard({ title }) {
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-teal-500 to-teal-700 text-white">
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-12">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-3 text-white/85">
          Placeholder dashboard route. You are authenticated and routed correctly.
        </p>
      </main>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthCallbackHandler>
        <Routes>
          <Route path="/" element={<App />} />
          <Route
            path="/intern/dashboard"
            element={<SimpleDashboard title="Intern Dashboard" />}
          />
          <Route
            path="/mentor/dashboard"
            element={<SimpleDashboard title="Mentor Dashboard" />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthCallbackHandler>
    </BrowserRouter>
  </React.StrictMode>
);
