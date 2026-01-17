import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FaExternalLinkAlt,
  FaGithub,
  FaSearch,
  FaSignOutAlt,
  FaUserCircle,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";

/**
 * MentorInternList
 * - Mentor-only page listing interns from `profiles` table.
 * - Click an intern to navigate to Intern Detail page.
 *
 * Data:
 * - profiles: { user_id, first_name, last_name, github_url, role, updated_at, created_at }
 */

const PROFILES_TABLE = "profiles";

function displayNameFromProfile(p) {
  const fn = (p?.first_name || "").trim();
  const ln = (p?.last_name || "").trim();
  const combined = [fn, ln].filter(Boolean).join(" ");
  return combined || p?.email || p?.user_id || "Intern";
}

function normalizeGithubUrl(url) {
  const v = (url || "").trim();
  if (!v) return "";
  return v;
}

function formatUpdatedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

// PUBLIC_INTERFACE
export default function MentorInternList() {
  /** Mentor-only list of interns, sourced from Supabase `profiles`. */
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  const [mentorProfileLoading, setMentorProfileLoading] = useState(false);
  const [mentorProfileError, setMentorProfileError] = useState(null);
  const [mentorRole, setMentorRole] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [interns, setInterns] = useState([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadMentorRoleAndData() {
      if (!user?.id) return;

      setMentorProfileError(null);
      setMentorProfileLoading(true);

      const { data: roleRow, error: roleErr } = await supabase
        .from(PROFILES_TABLE)
        .select("role, first_name, last_name")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!mounted) return;

      if (roleErr) {
        setMentorProfileError(roleErr.message || "Failed to load your role.");
        setMentorRole(null);
        setMentorProfileLoading(false);
        return;
      }

      const role = roleRow?.role || null;
      setMentorRole(role);
      setMentorProfileLoading(false);

      if (role !== "mentor") return;

      await refreshInterns();
    }

    void loadMentorRoleAndData();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function refreshInterns() {
    setError(null);
    setLoading(true);
    try {
      // Only interns. We do not assume email exists in profiles; use name/user_id for display.
      const { data, error: qErr } = await supabase
        .from(PROFILES_TABLE)
        .select("user_id, first_name, last_name, github_url, role, updated_at, created_at")
        .eq("role", "intern")
        .order("updated_at", { ascending: false });

      if (qErr) throw qErr;
      setInterns(data || []);
    } catch (e) {
      setError(e?.message || "Failed to load interns.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return interns;
    return interns.filter((p) => {
      const name = displayNameFromProfile(p).toLowerCase();
      const gh = normalizeGithubUrl(p?.github_url).toLowerCase();
      const id = String(p?.user_id || "").toLowerCase();
      return name.includes(q) || gh.includes(q) || id.includes(q);
    });
  }, [interns, query]);

  if (authLoading || mentorProfileLoading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl px-6 py-12">Loading…</div>
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

  // Mentor-only access (mentor role is loaded from profiles).
  if (mentorProfileError) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h1 className="text-2xl font-bold">Unable to load mentor role</h1>
          <p className="mt-3 text-white/70">{mentorProfileError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex rounded-xl bg-orange-500 px-5 py-3 font-semibold text-black hover:bg-orange-400"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (mentorRole !== "mentor") {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h1 className="text-2xl font-bold">Access denied</h1>
          <p className="mt-3 text-white/70">
            This area is available to mentors only.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex rounded-xl bg-orange-500 px-5 py-3 font-semibold text-black hover:bg-orange-400"
          >
            Go to home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-black/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10">
              <FaUserCircle className="h-6 w-6 text-white/80" />
            </div>
            <div>
              <div className="text-xs text-white/50">Mentor</div>
              <div className="text-sm font-extrabold">{user.email}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshInterns}
              className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10"
            >
              Refresh
            </button>
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
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key="mentor-intern-list"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          >
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-extrabold">Interns</h1>
                <p className="mt-2 text-sm text-white/60">
                  Select an intern to review their profile and submissions.
                </p>
              </div>

              <div className="w-full sm:w-[360px]">
                <label className="text-xs font-bold text-white/60">Search</label>
                <div className="mt-2 flex items-center gap-2 rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
                  <FaSearch className="text-white/60" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
                    placeholder="Name, GitHub URL, or user id…"
                    aria-label="Search interns"
                  />
                </div>
              </div>
            </div>

            {error ? (
              <div className="mt-6 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 ring-1 ring-red-500/20">
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="mt-8 text-sm text-white/70">Loading interns…</div>
            ) : filtered.length === 0 ? (
              <div className="mt-8 rounded-2xl bg-white/5 p-6 text-sm text-white/70 ring-1 ring-white/10">
                No interns found.
              </div>
            ) : (
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((p) => {
                  const name = displayNameFromProfile(p);
                  const gh = normalizeGithubUrl(p?.github_url);
                  const updatedAt = p?.updated_at || p?.created_at;

                  return (
                    <button
                      key={p.user_id}
                      type="button"
                      onClick={() => navigate(`/mentor/interns/${p.user_id}`)}
                      className="group text-left rounded-2xl bg-white/5 p-6 ring-1 ring-white/10 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                      aria-label={`Open details for ${name}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div
                            className="truncate text-lg font-extrabold"
                            style={{ color: "#00f9ef" }}
                          >
                            {name}
                          </div>
                          <div className="mt-1 text-xs text-white/50">
                            {p?.user_id}
                          </div>
                        </div>
                        <FaExternalLinkAlt className="mt-1 text-white/40 transition group-hover:text-white/70" />
                      </div>

                      <div className="mt-4 space-y-2">
                        <div className="text-xs text-white/60">
                          Last updated:{" "}
                          <span className="text-white/80">
                            {formatUpdatedAt(updatedAt) || "—"}
                          </span>
                        </div>

                        {gh ? (
                          <div className="inline-flex items-center gap-2 rounded-full bg-black/30 px-3 py-2 text-xs font-bold ring-1 ring-white/10">
                            <FaGithub style={{ color: "#00f9ef" }} />
                            <span className="max-w-[220px] truncate">
                              {gh}
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-white/45">
                            No GitHub URL on file.
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
