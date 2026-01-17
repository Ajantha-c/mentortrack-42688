import React, { useEffect, useMemo, useState } from "react";
import { subscribeToTasksChanges } from "../lib/realtimeTasks";
import { AnimatePresence, motion } from "framer-motion";
import {
  FaArrowLeft,
  FaDownload,
  FaGithub,
  FaSignOutAlt,
  FaUserCircle,
} from "react-icons/fa";
import { Calendar, Clock, Send, X } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { forceDownloadFromSupabaseStorage } from "../utils/download";
import { parseMeetingDetailsFromTask } from "../lib/realtimeTasks";

/**
 * MentorInternDetail
 * - Mentor-only detail view for a selected intern.
 * - Shows intern profile fields and lists their tasks.
 * - Adds mentor action controls per spec:
 *    - Reviewed Successfully => status='reviewed' (card turns light green)
 *    - Schedule Meeting => modal with datetime + agenda, updates status='meeting_scheduled' and saves details (card turns light yellow)
 *    - Remarks + => modal to write remarks, updates mentor_remarks (no card color change unless status also set)
 * - Realtime subscription to keep the list updated without refresh.
 *
 * NOTE: This implementation assumes the `tasks` table includes:
 * - status (string, nullable)
 * - mentor_remarks (string, nullable)
 * and meeting details can be stored in:
 * - meeting_details (json/json-string) OR meeting_scheduled_at/meeting_datetime + meeting_agenda.
 * Since schema isn't fully specified in the provided codebase, we write BOTH:
 * - meeting_details: { datetime, agenda }
 * - meeting_scheduled_at: datetime
 * - meeting_agenda: agenda
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

function statusStyle(status) {
  if (status === "reviewed") {
    return {
      bg: "rgba(16,185,129,0.14)",
      ring: "rgba(16,185,129,0.30)",
      badgeBg: "rgba(16,185,129,0.22)",
      badgeText: "rgba(209,250,229,0.95)",
      label: "Reviewed Successfully",
    };
  }
  if (status === "meeting_scheduled") {
    return {
      bg: "rgba(250,204,21,0.12)",
      ring: "rgba(250,204,21,0.28)",
      badgeBg: "rgba(250,204,21,0.20)",
      badgeText: "rgba(254,249,195,0.95)",
      label: "Meeting Scheduled",
    };
  }
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

// PUBLIC_INTERFACE
export default function MentorInternDetail() {
  /** Mentor-only intern detail screen with tasks list, mentor actions, and attachment download flow. */
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

  // Mentor actions state
  const [actionBusyId, setActionBusyId] = useState(null);

  const [meetingOpen, setMeetingOpen] = useState(false);
  const [meetingTaskId, setMeetingTaskId] = useState(null);

  // Meeting picker state:
  // We keep date and time separate to support calendar/clock pickers and avoid typing.
  const [meetingDate, setMeetingDate] = useState(""); // YYYY-MM-DD
  const [meetingTime, setMeetingTime] = useState(""); // HH:mm
  const [meetingAgenda, setMeetingAgenda] = useState("");
  const [meetingError, setMeetingError] = useState(null);

  function combineDateTimeToIso(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    // Interpret as local time then convert to ISO for storage.
    const dt = new Date(`${dateStr}T${timeStr}`);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString();
  }

  function splitIsoToLocalDateTimeParts(iso) {
    if (!iso) return { date: "", time: "" };
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { date: "", time: "" };

    // Convert to "local" parts without timezone drift.
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16); // YYYY-MM-DDTHH:mm
    const [date, time] = local.split("T");
    return { date: date || "", time: time || "" };
  }

  const [remarksOpen, setRemarksOpen] = useState(false);
  const [remarksTaskId, setRemarksTaskId] = useState(null);
  const [remarksText, setRemarksText] = useState("");
  const [remarksError, setRemarksError] = useState(null);

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

  // NEW: subscribe to UPDATE changes for this intern so mentor sees live updates too
  useEffect(() => {
    if (!internId) return undefined;
    if (mentorRole !== "mentor") return undefined;

    let sub;
    try {
      sub = subscribeToTasksChanges({
        userId: internId,
        events: ["UPDATE"],
        onChange: (payload) => {
          const newRow = payload?.new || null;
          if (!newRow?.id) return;

          setTasks((prev) => {
            const normalized = {
              ...newRow,
              attachments: normalizeAttachments(newRow.attachments),
            };
            return (prev || []).map((t) => (t.id === normalized.id ? normalized : t));
          });
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[realtime] mentor subscribe failed:", e);
    }

    return () => {
      void sub?.unsubscribe?.();
    };
  }, [internId, mentorRole]);

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

  // PUBLIC_INTERFACE
  async function markReviewed(taskId) {
    /** Sets task.status='reviewed' and updates updated_at. */
    if (!taskId) return;
    setActionBusyId(taskId);
    try {
      const { error } = await supabase
        .from(TASKS_TABLE)
        .update({ status: "reviewed", updated_at: nowIso() })
        .eq("id", taskId)
        .eq("user_id", internId);

      if (error) throw error;
    } catch (e) {
      alert(e?.message || "Failed to mark as reviewed.");
    } finally {
      setActionBusyId(null);
    }
  }

  function openMeetingModal(task) {
    setMeetingError(null);
    setMeetingTaskId(task.id);

    const existing = parseMeetingDetailsFromTask(task);
    const parts = splitIsoToLocalDateTimeParts(existing?.datetime || null);

    setMeetingDate(parts.date);
    setMeetingTime(parts.time);
    setMeetingAgenda(existing?.agenda || "");
    setMeetingOpen(true);
  }

  // PUBLIC_INTERFACE
  async function saveMeeting() {
    /** Writes meeting schedule fields and sets status='meeting_scheduled'. */
    if (!meetingTaskId) return;

    if (!meetingDate || !meetingTime) {
      setMeetingError("Please select a meeting date and time.");
      return;
    }

    const dtIso = combineDateTimeToIso(meetingDate, meetingTime);
    if (!dtIso) {
      setMeetingError("Invalid date/time selection.");
      return;
    }

    setMeetingError(null);
    setActionBusyId(meetingTaskId);

    try {
      const payload = {
        status: "meeting_scheduled",
        meeting_details: { datetime: dtIso, agenda: meetingAgenda?.trim() || null },
        meeting_scheduled_at: dtIso,
        meeting_agenda: meetingAgenda?.trim() || null,
        updated_at: nowIso(),
      };

      const { error } = await supabase
        .from(TASKS_TABLE)
        .update(payload)
        .eq("id", meetingTaskId)
        .eq("user_id", internId);

      if (error) throw error;

      setMeetingOpen(false);
      setMeetingTaskId(null);
      setMeetingDate("");
      setMeetingTime("");
      setMeetingAgenda("");
    } catch (e) {
      setMeetingError(e?.message || "Failed to schedule meeting.");
    } finally {
      setActionBusyId(null);
    }
  }

  function openRemarksModal(task) {
    setRemarksError(null);
    setRemarksTaskId(task.id);
    setRemarksText(task.mentor_remarks || "");
    setRemarksOpen(true);
  }

  // PUBLIC_INTERFACE
  async function saveRemarks() {
    /** Writes mentor_remarks to the task row. */
    if (!remarksTaskId) return;
    if (!remarksText.trim()) {
      setRemarksError("Please enter a remark.");
      return;
    }

    setRemarksError(null);
    setActionBusyId(remarksTaskId);
    try {
      const { error } = await supabase
        .from(TASKS_TABLE)
        .update({ mentor_remarks: remarksText.trim(), updated_at: nowIso() })
        .eq("id", remarksTaskId)
        .eq("user_id", internId);

      if (error) throw error;

      setRemarksOpen(false);
      setRemarksTaskId(null);
      setRemarksText("");
    } catch (e) {
      setRemarksError(e?.message || "Failed to save remarks.");
    } finally {
      setActionBusyId(null);
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
          <p className="mt-3 text-white/70">This area is available to mentors only.</p>
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
                    <div className="mt-5 text-sm text-white/70">Loading profile…</div>
                  ) : (
                    <div className="mt-5 space-y-4">
                      <div>
                        <div className="text-xs font-bold text-white/60">Name</div>
                        <div className="mt-1 text-sm font-extrabold">{internName}</div>
                        <div className="mt-1 text-xs text-white/50">
                          user_id: <span className="font-mono">{internId}</span>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-bold text-white/60">GitHub</div>
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
                          <div className="mt-2 text-sm text-white/60">No GitHub URL on file.</div>
                        )}
                      </div>

                      <div className="rounded-2xl bg-black/30 p-4 ring-1 ring-white/10">
                        <div className="text-xs font-bold text-white/60">Status</div>
                        <div className="mt-2 text-sm text-white/80">
                          Role:{" "}
                          <span className="font-semibold">{internProfile?.role || "unknown"}</span>
                        </div>
                        <div className="mt-1 text-xs text-white/50">
                          Updated:{" "}
                          {formatDateTime(internProfile?.updated_at || internProfile?.created_at) ||
                            "—"}
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
                      Tasks from <span className="font-mono">{TASKS_TABLE}</span> for this intern.
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
                    {tasks.map((t) => {
                      const status = t.status || null;
                      const style = statusStyle(status);
                      const meeting = parseMeetingDetailsFromTask(t);
                      const busy = actionBusyId === t.id;

                      return (
                        <motion.div
                          key={t.id}
                          layout
                          className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10"
                          style={{
                            backgroundColor: style?.bg || undefined,
                            borderColor: style?.ring || undefined,
                          }}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-lg font-extrabold" style={{ color: "#00f9ef" }}>
                                  {t.work_title || "Untitled"}
                                </div>

                                <AnimatePresence initial={false}>
                                  {style ? (
                                    <motion.div
                                      key={`badge:${t.id}:${status}`}
                                      initial={{ opacity: 0, y: -6 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: -6 }}
                                      transition={{ duration: 0.22, ease: "easeOut" }}
                                      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold ring-1"
                                      style={{
                                        backgroundColor: style.badgeBg,
                                        color: style.badgeText,
                                        borderColor: style.ring,
                                      }}
                                    >
                                      {style.label}
                                    </motion.div>
                                  ) : null}
                                </AnimatePresence>
                              </div>

                              <div className="mt-1 text-xs text-white/50">
                                {formatDateTime(t.created_at)}
                                {t.updated_at && t.updated_at !== t.created_at ? (
                                  <> • Updated: {formatDateTime(t.updated_at)}</>
                                ) : null}
                              </div>
                            </div>

                            {/* Mentor action buttons (badge-style) */}
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void markReviewed(t.id)}
                                className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-4 py-2 text-xs font-extrabold text-emerald-100 ring-1 ring-emerald-400/20 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label="Reviewed Successfully"
                              >
                                Reviewed Successfully
                              </button>

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openMeetingModal(t)}
                                className="inline-flex items-center gap-2 rounded-full bg-yellow-500/15 px-4 py-2 text-xs font-extrabold text-yellow-100 ring-1 ring-yellow-400/20 hover:bg-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label="Schedule Meeting"
                              >
                                <Clock className="h-4 w-4" />
                                Schedule Meeting
                              </button>

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openRemarksModal(t)}
                                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-extrabold text-white ring-1 ring-white/15 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label="Remarks"
                              >
                                Remarks +
                              </button>
                            </div>
                          </div>

                          <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
                            {t.description}
                          </div>

                          <AnimatePresence initial={false}>
                            {(t.mentor_remarks || "").trim() ? (
                              <motion.div
                                key={`mentor-remarks:${t.id}`}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.22, ease: "easeOut" }}
                                className="relative mt-4 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15"
                              >
                                <div className="absolute -top-2 left-6 h-4 w-4 rotate-45 bg-white/10 ring-1 ring-white/15" />
                                <div className="text-xs font-bold text-white/70">Your Remarks</div>
                                <div className="mt-2 whitespace-pre-wrap text-sm text-white/85">
                                  {t.mentor_remarks}
                                </div>
                              </motion.div>
                            ) : null}
                          </AnimatePresence>

                          <AnimatePresence initial={false}>
                            {status === "meeting_scheduled" && meeting ? (
                              <motion.div
                                key={`meeting:${t.id}`}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 8 }}
                                transition={{ duration: 0.22, ease: "easeOut" }}
                                className="mt-4 rounded-2xl bg-black/20 p-4 ring-1 ring-yellow-400/20"
                              >
                                <div className="text-xs font-bold text-yellow-100/90">
                                  Scheduled meeting
                                </div>
                                {meeting?.datetime ? (
                                  <div className="mt-1 text-sm text-white/80">
                                    When:{" "}
                                    <span className="font-semibold">
                                      {formatDateTime(meeting.datetime)}
                                    </span>
                                  </div>
                                ) : null}
                                {meeting?.agenda ? (
                                  <div className="mt-2 text-sm text-white/80">
                                    Agenda:{" "}
                                    <span className="text-white/90">{meeting.agenda}</span>
                                  </div>
                                ) : null}
                              </motion.div>
                            ) : null}
                          </AnimatePresence>

                          {Array.isArray(t.attachments) && t.attachments.length > 0 ? (
                            <div className="mt-5">
                              <div className="text-xs font-bold text-white/60">Files</div>
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
                                    <span className="max-w-[220px] truncate">{a.name || "file"}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Schedule Meeting Modal */}
      <AnimatePresence>
        {meetingOpen ? (
          <motion.div
            key="meeting-modal"
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setMeetingOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.985 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="w-full max-w-lg rounded-2xl bg-white/90 p-6 text-black shadow-2xl ring-1 ring-black/10 backdrop-blur"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-extrabold">Schedule meeting</div>
                  <div className="mt-1 text-sm text-black/60">
                    Pick a date/time and share a short agenda.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setMeetingOpen(false)}
                  className="inline-flex items-center justify-center rounded-lg bg-black/5 px-3 py-2 text-xs font-bold ring-1 ring-black/10 hover:bg-black/10"
                  aria-label="Close meeting modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {meetingError ? (
                <div className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-700 ring-1 ring-red-500/20">
                  {meetingError}
                </div>
              ) : null}

              <div className="mt-5 space-y-4">
                <div>
                  <label className="text-sm font-semibold text-black/80">Date</label>

                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-white px-4 py-3 ring-1 ring-black/15">
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById("meeting-date-picker");
                        if (el?.showPicker) el.showPicker();
                        else el?.click?.();
                      }}
                      className="inline-flex items-center justify-center rounded-lg bg-black/5 p-2 ring-1 ring-black/10 hover:bg-black/10"
                      aria-label="Open date picker"
                    >
                      <Calendar className="h-4 w-4" />
                    </button>

                    <div className="flex-1 text-sm text-black/70">
                      {meetingDate ? meetingDate : "Select a date"}
                    </div>

                    {/* Hidden native date input to force system picker (no typing) */}
                    <input
                      id="meeting-date-picker"
                      type="date"
                      value={meetingDate}
                      onChange={(e) => setMeetingDate(e.target.value)}
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-black/80">Time</label>

                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-white px-4 py-3 ring-1 ring-black/15">
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById("meeting-time-picker");
                        if (el?.showPicker) el.showPicker();
                        else el?.click?.();
                      }}
                      className="inline-flex items-center justify-center rounded-lg bg-black/5 p-2 ring-1 ring-black/10 hover:bg-black/10"
                      aria-label="Open time picker"
                    >
                      <Clock className="h-4 w-4" />
                    </button>

                    <div className="flex-1 text-sm text-black/70">
                      {meetingTime ? meetingTime : "Select a time"}
                    </div>

                    {/* Hidden native time input to force system picker (no typing) */}
                    <input
                      id="meeting-time-picker"
                      type="time"
                      value={meetingTime}
                      onChange={(e) => setMeetingTime(e.target.value)}
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  </div>

                  <div className="mt-1 text-xs text-black/50">
                    Uses your device’s system pickers.
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-black/80">
                    Meeting agenda
                  </label>
                  <textarea
                    value={meetingAgenda}
                    onChange={(e) => setMeetingAgenda(e.target.value)}
                    className="mt-2 min-h-[90px] w-full resize-y rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-black/15 focus:outline-none focus:ring-2"
                    style={{ outlineColor: "#00f9ef" }}
                    placeholder="Short agenda / discussion topics…"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void saveMeeting()}
                  disabled={actionBusyId === meetingTaskId}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-extrabold text-black ring-1 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    backgroundColor: "#00f9ef",
                    borderColor: "rgba(0,0,0,0.15)",
                  }}
                >
                  <Send className="h-4 w-4" />
                  {actionBusyId === meetingTaskId ? "Sending…" : "Send"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Remarks Modal */}
      <AnimatePresence>
        {remarksOpen ? (
          <motion.div
            key="remarks-modal"
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setRemarksOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.985 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="w-full max-w-lg rounded-2xl bg-white/90 p-6 text-black shadow-2xl ring-1 ring-black/10 backdrop-blur"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-extrabold">Remarks</div>
                  <div className="mt-1 text-sm text-black/60">
                    Leave feedback for the intern.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setRemarksOpen(false)}
                  className="inline-flex items-center justify-center rounded-lg bg-black/5 px-3 py-2 text-xs font-bold ring-1 ring-black/10 hover:bg-black/10"
                  aria-label="Close remarks modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {remarksError ? (
                <div className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-700 ring-1 ring-red-500/20">
                  {remarksError}
                </div>
              ) : null}

              <div className="mt-5 space-y-4">
                <div>
                  <label className="text-sm font-semibold text-black/80">
                    Feedback
                  </label>
                  <textarea
                    value={remarksText}
                    onChange={(e) => setRemarksText(e.target.value)}
                    className="mt-2 min-h-[120px] w-full resize-y rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-black/15 focus:outline-none focus:ring-2"
                    style={{ outlineColor: "#00f9ef" }}
                    placeholder="Write remarks…"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void saveRemarks()}
                  disabled={actionBusyId === remarksTaskId}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-extrabold text-black ring-1 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    backgroundColor: "#00f9ef",
                    borderColor: "rgba(0,0,0,0.15)",
                  }}
                >
                  <Send className="h-4 w-4" />
                  {actionBusyId === remarksTaskId ? "Sending…" : "Send"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
