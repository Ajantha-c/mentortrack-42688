import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  FaArrowLeft,
  FaDownload,
  FaGithub,
  FaSignOutAlt,
  FaUserCircle,
} from "react-icons/fa";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { forceDownloadFromSupabaseStorage } from "../utils/download";

/**
 * MentorInternDetail
 * - Mentor-only detail view for a selected intern.
 * - Shows intern profile fields and lists their tasks.
 * - Attachments are downloaded via Supabase Storage download() to force download.
 *
 * Data:
 * - profiles table for intern
 * - tasks table for intern submissions
 */

const PROFILES_TABLE = "profiles";
const TASKS_TABLE = "tasks";
const STORAGE_BUCKET = "task-files";

function formatDateTime(iso) {
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

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((a) => ({
      path: a?.path || a?.storage_path || a?.file_path || null,
      name: a?.name || a?.file_name || null,
      size: typeof a?.size === "number" ? a.size : null,
      contentType: a?.contentType || a?.content_type || null,
    }))
    .filter((a) => a.path);
}

function displayNameFromProfile(p) {
  const fn = (p?.first_name || "").trim();
  const ln = (p?.last_name || "").trim();
  const combined = [fn, ln].filter(Boolean).join(" ");
  return combined || p?.user_id || "Intern";
}

// PUBLIC_INTERFACE
export default function MentorInternDetail() {
  /** Mentor-only intern detail screen with tasks list and attachment download flow. */
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { internId } = useParams();

  const [mentorRoleLoading, setMentorRoleLoading] = useState(false);
  const [mentorRoleError, setMentorRoleError] = useState(null);
  const [mentorRole, setMentorRole] = useState(null);

  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [internProfile, setInternProfile] = useState(null);

  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState(null);
  const [tasks, setTasks] = useState([]);

  const internName = useMemo(
    () => displayNameFromProfile(internProfile) || internId || "Intern",
    [internProfile, internId]
  );

  useEffect(() => {
    let mounted = true;

    async function loadMentorRole() {
      if (!user?.id) return;
      setMentorRoleError(null);
      setMentorRoleLoading(true);

      const { data, error } = await supabase
        .from(PROFILES_TABLE)
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        setMentorRoleError(error.message || "Failed to load your role.");
        setMentorRole(null);
      } else {
        setMentorRole(data?.role || null);
      }
      setMentorRoleLoading(false);
    }

    void loadMentorRole();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    if (!internId) return;
    if (mentorRole !== "mentor") return;

    void loadInternProfile();
    void loadInternTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, internId, mentorRole]);

  async function loadInternProfile() {
    setProfileError(null);
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from(PROFILES_TABLE)
        .select("user_id, first_name, last_name, github_url, role, created_at, updated_at")
        .eq("user_id", internId)
        .maybeSingle();

      if (error) throw error;

      // Soft check: mentor is allowed to view even if role is missing, but we label it.
      setInternProfile(data || null);
    } catch (e) {
      setProfileError(e?.message || "Failed to load intern profile.");
      setInternProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }

  async function loadInternTasks() {
    setTasksError(null);
    setTasksLoading(true);
    try {
      const { data, error } = await supabase
        .from(TASKS_TABLE)
        .select("*")
        .eq("user_id", internId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setTasks(
        (data || []).map((t) => ({
          ...t,
          attachments: normalizeAttachments(t.attachments),
        }))
      );
    } catch (e) {
      setTasksError(e?.message || "Failed to load tasks.");
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }

  async function handleDownload(att) {
    try {
      await forceDownloadFromSupabaseStorage({
        bucket: STORAGE_BUCKET,
        path: att.path,
        filename: att.name,
      });
    } catch (e) {
      alert(e?.message || "Failed to download.");
    }
  }

  if (authLoading || mentorRoleLoading) {
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
          <h1 className="text-2xl font-bold">Mentor • Intern Detail</h1>
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

  if (mentorRoleError) {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h1 className="text-2xl font-bold">Unable to load mentor role</h1>
          <p className="mt-3 text-white/70">{mentorRoleError}</p>
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
            <Link
              to="/mentor"
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-sm font-extrabold ring-1 ring-white/10 hover:bg-white/10"
              aria-label="Back to intern list"
            >
              <FaArrowLeft />
              Back
            </Link>

            <div className="hidden h-10 w-px bg-white/10 sm:block" />

            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10">
                <FaUserCircle className="h-6 w-6 text-white/80" />
              </div>
              <div>
                <div className="text-xs text-white/50">Intern</div>
                <div className="text-sm font-extrabold">{internName}</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadInternTasks}
              className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10"
            >
              Refresh tasks
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
            key={`mentor-intern-detail:${internId}`}
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -14 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          >
            <div className="grid gap-8 lg:grid-cols-5">
              {/* Profile */}
              <section className="lg:col-span-2">
                <div className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
                  <h2 className="text-xl font-extrabold">Profile</h2>

                  {profileError ? (
                    <div className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 ring-1 ring-red-500/20">
                      {profileError}
                    </div>
                  ) : null}

                  {profileLoading ? (
                    <div className="mt-5 text-sm text-white/70">
                      Loading profile…
                    </div>
                  ) : (
                    <div className="mt-5 space-y-4">
                      <div>
                        <div className="text-xs font-bold text-white/60">
                          Name
                        </div>
                        <div className="mt-1 text-sm font-extrabold">
                          {internName}
                        </div>
                        <div className="mt-1 text-xs text-white/50">
                          user_id: <span className="font-mono">{internId}</span>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-bold text-white/60">
                          GitHub
                        </div>
                        {internProfile?.github_url ? (
                          <a
                            href={internProfile.github_url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10"
                            style={{ color: "#00f9ef" }}
                          >
                            <FaGithub />
                            Open GitHub
                          </a>
                        ) : (
                          <div className="mt-2 text-sm text-white/60">
                            No GitHub URL on file.
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl bg-black/30 p-4 ring-1 ring-white/10">
                        <div className="text-xs font-bold text-white/60">
                          Status
                        </div>
                        <div className="mt-2 text-sm text-white/80">
                          Role:{" "}
                          <span className="font-semibold">
                            {internProfile?.role || "unknown"}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-white/50">
                          Updated:{" "}
                          {formatDateTime(
                            internProfile?.updated_at || internProfile?.created_at
                          ) || "—"}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => navigate("/mentor")}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-extrabold text-black hover:bg-emerald-400"
                      >
                        <FaArrowLeft />
                        Back to intern list
                      </button>
                    </div>
                  )}
                </div>
              </section>

              {/* Tasks */}
              <section className="lg:col-span-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-extrabold">Submissions</h2>
                    <p className="mt-1 text-sm text-white/60">
                      Tasks from <span className="font-mono">{TASKS_TABLE}</span>{" "}
                      for this intern.
                    </p>
                  </div>
                </div>

                {tasksError ? (
                  <div className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 ring-1 ring-red-500/20">
                    {tasksError}
                  </div>
                ) : null}

                {tasksLoading ? (
                  <div className="mt-6 text-sm text-white/70">Loading tasks…</div>
                ) : tasks.length === 0 ? (
                  <div className="mt-6 rounded-2xl bg-white/5 p-6 text-sm text-white/70 ring-1 ring-white/10">
                    No submissions yet.
                  </div>
                ) : (
                  <div className="mt-6 space-y-4">
                    {tasks.map((t) => (
                      <div
                        key={t.id}
                        className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div
                              className="text-lg font-extrabold"
                              style={{ color: "#00f9ef" }}
                            >
                              {t.work_title || "Untitled"}
                            </div>
                            <div className="mt-1 text-xs text-white/50">
                              {formatDateTime(t.created_at)}
                              {t.updated_at && t.updated_at !== t.created_at ? (
                                <> • Updated: {formatDateTime(t.updated_at)}</>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
                          {t.description}
                        </div>

                        {Array.isArray(t.attachments) &&
                        t.attachments.length > 0 ? (
                          <div className="mt-5">
                            <div className="text-xs font-bold text-white/60">
                              Files
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {t.attachments.map((a) => (
                                <button
                                  key={a.path}
                                  type="button"
                                  onClick={() => handleDownload(a)}
                                  className="inline-flex items-center gap-2 rounded-full bg-black/30 px-4 py-2 text-xs font-bold ring-1 ring-white/10 hover:bg-black/40"
                                  aria-label={`Download ${a.name || "file"}`}
                                >
                                  <FaDownload style={{ color: "#00f9ef" }} />
                                  <span className="max-w-[220px] truncate">
                                    {a.name || "file"}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
