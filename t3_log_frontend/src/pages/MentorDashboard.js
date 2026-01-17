import React from "react";
import { FaSignOutAlt } from "react-icons/fa";
import { useAuth } from "../contexts/AuthContext";

/**
 * MentorDashboard
 * Minimal mentor landing page placeholder.
 * This is intentionally lightweight to unblock role-based routing.
 */
export default function MentorDashboard() {
  const { user, loading: authLoading, signOut } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl px-6 py-12">Loading session…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h1 className="text-2xl font-bold">Mentor Dashboard</h1>
          <p className="mt-3 text-white/70">
            You are not signed in. Return to the home page to authenticate.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex rounded-xl bg-orange-500 px-5 py-3 font-semibold text-black hover:bg-orange-400"
          >
            Go to sign-in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-teal-500 to-teal-700 text-white">
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold">Mentor Dashboard</h1>
            <p className="mt-2 text-white/85">
              Signed in as <span className="font-semibold">{user.email}</span>
            </p>
            <p className="mt-2 text-sm text-white/80">
              This page is a placeholder. Mentor workflow screens can be added here
              next (review submissions, kanban, feedback).
            </p>
          </div>

          <button
            type="button"
            onClick={async () => {
              await signOut();
              window.location.href = "/";
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-extrabold text-black hover:bg-orange-400"
          >
            <FaSignOutAlt />
            Sign out
          </button>
        </div>
      </main>
    </div>
  );
}
