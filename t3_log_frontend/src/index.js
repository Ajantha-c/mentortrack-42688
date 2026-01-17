import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import "./index.css";
import App from "./App";
import { supabase } from "./lib/supabaseClient";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import InternDashboard from "./pages/InternDashboard";

/**
 * Auth redirect behavior (fix for post-sign-in 404):
 * - We treat "/" as the canonical post-auth landing route.
 * - Successful auth (OAuth callback or any subsequent sign-in event) navigates to "/".
 * - When an authenticated user loads the app, we also normalize them to "/".
 */
function AuthCallbackHandler({ children }) {
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;

    async function normalizeAuthLanding() {
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

      // If the user is already authenticated (including OAuth callback landing),
      // force them to "/" so we never depend on nested dashboard routes that can 404.
      if (session) {
        navigate("/", { replace: true });
      }
    }

    // Run on initial load (covers OAuth callback landing)
    normalizeAuthLanding();

    // Also listen for future auth state transitions
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) return;
        navigate("/", { replace: true });
      }
    );

    return () => {
      isMounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, [navigate]);

  return children;
}

/**
 * RootRoute:
 * - If authenticated => show InternDashboard at "/"
 * - Else => show the landing page (role selection) at "/"
 */
function RootRoute() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl px-6 py-12">Loading session…</div>
      </div>
    );
  }

  return session ? <InternDashboard /> : <App />;
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
      <AuthProvider>
        <AuthCallbackHandler>
          <Routes>
            <Route path="/" element={<RootRoute />} />
            <Route
              path="/mentor/dashboard"
              element={<SimpleDashboard title="Mentor Dashboard" />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthCallbackHandler>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
