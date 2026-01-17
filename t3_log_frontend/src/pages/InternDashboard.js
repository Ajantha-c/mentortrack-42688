import React, { useEffect, useMemo, useState } from "react";
import {
  FaDownload,
  FaGithub,
  FaRegEdit,
  FaRegTrashAlt,
  FaSave,
  FaSignOutAlt,
  FaTimes,
  FaUserCircle,
} from "react-icons/fa";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { forceDownloadFromSupabaseStorage } from "../utils/download";

/**
 * Intern Dashboard (T3 Log) — Supabase-backed
 *
 * Data model alignment:
 * - profiles table: stores intern profile fields (first_name, last_name, github_url, user_id)
 * - tasks table: stores intern submissions/tasks and their metadata, including attachments
 * - task-files bucket: stores uploaded files
 *
 * Download requirement:
 * - Use supabase.storage.from('task-files').download(path) to avoid "opens as plain text"
 *   and to force correct file formats via Blob/objectURL download.
 */

const PROFILES_TABLE = "profiles";
const TASKS_TABLE = "tasks";
const STORAGE_BUCKET = "task-files";

/**
 * Upload layout:
 * Keep paths deterministic and scoped per user + task:
 *  task-files/tasks/<userId>/<taskId>/<uuid>_<filename>
 */
const STORAGE_ROOT = "tasks";

function nowIso() {
  return new Date().toISOString();
}

function safeName(name) {
  return (name || "file").replace(/[^\w.\-]+/g, "_");
}

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

function isValidUrl(url) {
  if (!url) return true;
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

async function upsertProfile({ userId, firstName, lastName, githubUrl }) {
  // Profiles table may be keyed by user_id. We do an "update then insert" fallback
  // to avoid making assumptions about unique constraints.
  const payload = {
    user_id: userId,
    first_name: firstName?.trim() || null,
    last_name: lastName?.trim() || null,
    github_url: githubUrl?.trim() || null,
    updated_at: nowIso(),
  };

  // Try update first
  const { data: updated, error: updateError } = await supabase
    .from(PROFILES_TABLE)
    .update(payload)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (updateError) throw updateError;
  if (updated) return updated;

  // If no row existed, insert
  const { data: inserted, error: insertError } = await supabase
    .from(PROFILES_TABLE)
    .insert([{ ...payload, created_at: nowIso() }])
    .select("*")
    .single();

  if (insertError) throw insertError;
  return inserted;
}

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
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

export default function InternDashboard() {
  /** Main Intern Dashboard page. */
  const { user, loading: authLoading, signOut } = useAuth();

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState(null);

  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileLastName, setProfileLastName] = useState("");
  const [profileGithubUrl, setProfileGithubUrl] = useState("");

  const [tasks, setTasks] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(null);

  const [formMode, setFormMode] = useState("create"); // create | edit
  const [editingId, setEditingId] = useState(null);

  const [workTitle, setWorkTitle] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState([]);
  const [formError, setFormError] = useState(null);
  const [formBusy, setFormBusy] = useState(false);

  // edit modal to manage existing attachments
  const [editOpen, setEditOpen] = useState(false);
  const [editRemoving, setEditRemoving] = useState(() => new Set());

  const displayName = useMemo(() => {
    const fn = profileFirstName?.trim();
    const ln = profileLastName?.trim();
    const combined = [fn, ln].filter(Boolean).join(" ");
    return combined || user?.email || "Intern";
  }, [profileFirstName, profileLastName, user?.email]);

  useEffect(() => {
    if (!user) return;
    void loadProfile();
    void refreshTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function loadProfile() {
    if (!user) return;
    setProfileError(null);
    setProfileLoading(true);
    try {
      const p = await fetchProfile(user.id);
      setProfileFirstName(p?.first_name || "");
      setProfileLastName(p?.last_name || "");
      setProfileGithubUrl(p?.github_url || "");
    } catch (e) {
      setProfileError(e?.message || "Failed to load profile.");
    } finally {
      setProfileLoading(false);
    }
  }

  async function refreshTasks() {
    if (!user) return;
    setListError(null);
    setListLoading(true);

    try {
      const { data, error } = await supabase
        .from(TASKS_TABLE)
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setTasks((data || []).map((t) => ({ ...t, attachments: normalizeAttachments(t.attachments) })));
    } catch (e) {
      setListError(e?.message || "Failed to load tasks.");
    } finally {
      setListLoading(false);
    }
  }

  function resetForm() {
    setFormMode("create");
    setEditingId(null);
    setWorkTitle("");
    setDescription("");
    setFiles([]);
    setFormError(null);
  }

  async function uploadAttachments({ userId, taskId, selectedFiles }) {
    if (!selectedFiles || selectedFiles.length === 0) return [];

    const uploaded = [];
    for (const f of selectedFiles) {
      const path = `${STORAGE_ROOT}/${userId}/${taskId}/${crypto.randomUUID()}_${safeName(f.name)}`;

      const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, f, {
        upsert: false,
        contentType: f.type || undefined,
      });
      if (error) throw error;

      uploaded.push({
        path,
        name: f.name,
        size: f.size,
        contentType: f.type || null,
      });
    }
    return uploaded;
  }

  async function deleteAttachmentsByPaths(paths) {
    const unique = Array.from(new Set((paths || []).filter(Boolean)));
    if (unique.length === 0) return;

    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(unique);
    // Best-effort cleanup: do not block DB changes for missing files.
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[storage] remove failed:", error);
    }
  }

  async function handleCreateOrUpdate(e) {
    e.preventDefault();
    setFormError(null);

    if (!user) {
      setFormError("You must be signed in.");
      return;
    }
    if (!workTitle.trim()) {
      setFormError("Please add a Work Title.");
      return;
    }
    if (!description.trim()) {
      setFormError("Please add a Description.");
      return;
    }

    setFormBusy(true);
    try {
      if (formMode === "create") {
        const createdAt = nowIso();

        // Create task row first to get id for structured storage paths.
        const { data: inserted, error: insertError } = await supabase
          .from(TASKS_TABLE)
          .insert([
            {
              user_id: user.id,
              work_title: workTitle.trim(),
              description: description.trim(),
              attachments: [],
              created_at: createdAt,
              updated_at: createdAt,
            },
          ])
          .select("*")
          .single();

        if (insertError) throw insertError;

        const newAttachments = await uploadAttachments({
          userId: user.id,
          taskId: inserted.id,
          selectedFiles: files,
        });

        const { data: updated, error: updateError } = await supabase
          .from(TASKS_TABLE)
          .update({
            attachments: newAttachments,
            updated_at: nowIso(),
          })
          .eq("id", inserted.id)
          .eq("user_id", user.id)
          .select("*")
          .single();

        if (updateError) throw updateError;

        setTasks((prev) => [{ ...updated, attachments: normalizeAttachments(updated.attachments) }, ...prev]);
        resetForm();
      } else {
        // Edit mode here updates just text fields (file management handled in edit modal).
        const target = tasks.find((t) => t.id === editingId);
        if (!target) throw new Error("Cannot find task to edit.");

        const { data: updated, error } = await supabase
          .from(TASKS_TABLE)
          .update({
            work_title: workTitle.trim(),
            description: description.trim(),
            updated_at: nowIso(),
          })
          .eq("id", target.id)
          .eq("user_id", user.id)
          .select("*")
          .single();

        if (error) throw error;

        setTasks((prev) =>
          prev.map((t) =>
            t.id === updated.id
              ? { ...updated, attachments: normalizeAttachments(updated.attachments) }
              : t
          )
        );
        resetForm();
      }
    } catch (e2) {
      setFormError(e2?.message || "Failed to submit.");
    } finally {
      setFormBusy(false);
    }
  }

  function openEditModal(task) {
    setFormMode("edit");
    setEditingId(task.id);
    setWorkTitle(task.work_title || "");
    setDescription(task.description || "");
    setFiles([]);
    setFormError(null);
    setEditRemoving(new Set());
    setEditOpen(true);
  }

  async function handleDeleteTask(task) {
    if (!user) return;
    const ok = window.confirm("Delete this task? This will also remove any uploaded files.");
    if (!ok) return;

    try {
      const existing = normalizeAttachments(task.attachments);
      await deleteAttachmentsByPaths(existing.map((a) => a.path));

      const { error } = await supabase
        .from(TASKS_TABLE)
        .delete()
        .eq("id", task.id)
        .eq("user_id", user.id);

      if (error) throw error;

      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      if (editingId === task.id) {
        resetForm();
        setEditOpen(false);
      }
    } catch (e) {
      alert(e?.message || "Failed to delete.");
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

  async function saveEditModalChanges() {
    if (!user) return;
    const target = tasks.find((t) => t.id === editingId);
    if (!target) return;

    setFormError(null);
    setFormBusy(true);
    try {
      // Remove selected existing attachments
      const existing = normalizeAttachments(target.attachments);
      const removeSet = editRemoving || new Set();
      const toRemove = existing.filter((a) => removeSet.has(a.path));
      const keep = existing.filter((a) => !removeSet.has(a.path));

      if (toRemove.length > 0) {
        await deleteAttachmentsByPaths(toRemove.map((a) => a.path));
      }

      // Upload any newly selected files and append
      const added = await uploadAttachments({
        userId: user.id,
        taskId: target.id,
        selectedFiles: files,
      });

      const nextAttachments = [...keep, ...added];

      const { data: updated, error } = await supabase
        .from(TASKS_TABLE)
        .update({
          work_title: workTitle.trim(),
          description: description.trim(),
          attachments: nextAttachments,
          updated_at: nowIso(),
        })
        .eq("id", target.id)
        .eq("user_id", user.id)
        .select("*")
        .single();

      if (error) throw error;

      setTasks((prev) =>
        prev.map((t) =>
          t.id === updated.id
            ? { ...updated, attachments: normalizeAttachments(updated.attachments) }
            : t
        )
      );

      setFiles([]);
      setEditRemoving(new Set());
      setEditOpen(false);
      resetForm();
    } catch (e) {
      setFormError(e?.message || "Failed to save changes.");
    } finally {
      setFormBusy(false);
    }
  }

  async function handleSaveProfile() {
    if (!user) return;

    setProfileError(null);
    if (!isValidUrl(profileGithubUrl)) {
      setProfileError("GitHub URL is not a valid URL.");
      return;
    }

    setProfileSaving(true);
    try {
      const p = await upsertProfile({
        userId: user.id,
        firstName: profileFirstName,
        lastName: profileLastName,
        githubUrl: profileGithubUrl,
      });
      setProfileFirstName(p?.first_name || "");
      setProfileLastName(p?.last_name || "");
      setProfileGithubUrl(p?.github_url || "");
      setProfileOpen(false);
    } catch (e) {
      setProfileError(e?.message || "Failed to save profile.");
    } finally {
      setProfileSaving(false);
    }
  }

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
          <h1 className="text-2xl font-bold">Intern Dashboard</h1>
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
    <div className="min-h-screen bg-black text-white">
      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-black/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/10 hover:bg-white/10"
            aria-label="Open profile"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/10">
              <FaUserCircle className="h-5 w-5 text-white/80" />
            </div>
            <div className="text-left">
              <div className="text-xs text-white/50">Intern</div>
              <div className="text-sm font-extrabold">{displayName}</div>
            </div>
          </button>

          <div className="flex items-center gap-2">
            {profileGithubUrl ? (
              <a
                href={profileGithubUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10"
                aria-label="Open GitHub profile"
                style={{ color: "#00f9ef" }}
              >
                <FaGithub />
                GitHub
              </a>
            ) : null}

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
        <div className="grid gap-8 lg:grid-cols-5">
          {/* Submission form */}
          <section className="lg:col-span-2">
            <div className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold">
                    {formMode === "create" ? "New submission" : "Edit submission"}
                  </h2>
                  <p className="mt-1 text-sm text-white/60">
                    Automatic timestamping occurs on submit.
                  </p>
                </div>

                {formMode === "edit" ? (
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setEditOpen(false);
                    }}
                    className="rounded-lg bg-white/5 px-3 py-2 text-xs font-bold ring-1 ring-white/10 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>

              <form onSubmit={handleCreateOrUpdate} className="mt-5 space-y-4">
                <div>
                  <label className="text-sm font-semibold text-white/80">
                    Work Title
                  </label>
                  <input
                    value={workTitle}
                    onChange={(e) => setWorkTitle(e.target.value)}
                    className="mt-2 w-full rounded-xl bg-black/40 px-4 py-3 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                    placeholder="e.g., Week 3: Completed onboarding + first feature"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-white/80">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="mt-2 min-h-[140px] w-full resize-y rounded-xl bg-black/40 px-4 py-3 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                    placeholder="What did you do? What blockers? What next?"
                  />
                </div>

                {/* File upload: allowed in create; in edit, file mgmt is via modal */}
                <div>
                  <label className="text-sm font-semibold text-white/80">
                    Files (optional)
                  </label>
                  <input
                    type="file"
                    multiple
                    onChange={(e) => setFiles(Array.from(e.target.files || []))}
                    className="mt-2 block w-full text-sm text-white/70 file:mr-4 file:rounded-lg file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-white/15"
                  />
                  {files.length > 0 ? (
                    <div className="mt-2 text-xs text-white/60">
                      Selected: {files.map((f) => f.name).join(", ")}
                    </div>
                  ) : null}
                  {formMode === "edit" ? (
                    <div className="mt-2 text-xs text-white/50">
                      Tip: use the edit modal to add/remove files.
                    </div>
                  ) : null}
                </div>

                {formError ? (
                  <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 ring-1 ring-red-500/20">
                    {formError}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={formBusy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-extrabold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <FaSave />
                  {formBusy
                    ? "Saving…"
                    : formMode === "create"
                      ? "Submit"
                      : "Save text changes"}
                </button>
              </form>
            </div>

            <div
              className="mt-4 rounded-2xl p-5 ring-1"
              style={{
                background: "linear-gradient(135deg, rgba(0,249,239,0.12), rgba(0,0,0,1))",
                borderColor: "rgba(0,249,239,0.25)",
              }}
            >
              <div className="text-sm font-bold" style={{ color: "#00f9ef" }}>
                Automatic timestamping
              </div>
              <div className="mt-1 text-xs text-white/60">
                The system time is recorded automatically (or your Supabase DEFAULT NOW()).
              </div>
            </div>
          </section>

          {/* History */}
          <section className="lg:col-span-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold">History</h2>
                <p className="mt-1 text-sm text-white/60">Your past submissions.</p>
              </div>

              <button
                type="button"
                onClick={refreshTasks}
                className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10"
              >
                Refresh
              </button>
            </div>

            {listError ? (
              <div className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 ring-1 ring-red-500/20">
                {listError}
              </div>
            ) : null}

            {listLoading ? (
              <div className="mt-6 text-sm text-white/70">Loading submissions…</div>
            ) : tasks.length === 0 ? (
              <div className="mt-6 rounded-2xl bg-white/5 p-6 text-sm text-white/70 ring-1 ring-white/10">
                No submissions yet. Create your first one on the left.
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {tasks.map((t) => (
                  <div key={t.id} className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div
                          className="text-lg font-extrabold"
                          style={{ color: "#00f9ef" }}
                        >
                          {t.work_title || "Untitled"}
                        </div>
                        <div className="mt-1 text-xs text-white/50">
                          {formatDateTime(t.created_at)}{" "}
                          {t.updated_at && t.updated_at !== t.created_at ? (
                            <> • Updated: {formatDateTime(t.updated_at)}</>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(t)}
                          className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-bold ring-1 ring-white/10 hover:bg-white/10"
                        >
                          <FaRegEdit />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTask(t)}
                          className="inline-flex items-center gap-2 rounded-xl bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200 ring-1 ring-red-500/20 hover:bg-red-500/20"
                        >
                          <FaRegTrashAlt />
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-white/85">
                      {t.description}
                    </div>

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
      </main>

      {/* Profile modal (white glass) */}
      {profileOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setProfileOpen(false);
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-white/90 p-6 text-black shadow-2xl ring-1 ring-black/10 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-black/5 ring-1 ring-black/10">
                  <FaUserCircle className="h-7 w-7 text-black/60" />
                </div>
                <div>
                  <div className="text-lg font-extrabold">Profile</div>
                  <div className="text-sm text-black/60">{user.email}</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setProfileOpen(false)}
                className="rounded-lg bg-black/5 px-3 py-2 text-xs font-bold ring-1 ring-black/10 hover:bg-black/10"
              >
                <FaTimes />
              </button>
            </div>

            {profileError ? (
              <div className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-700 ring-1 ring-red-500/20">
                {profileError}
              </div>
            ) : null}

            {profileLoading ? (
              <div className="mt-4 text-sm text-black/70">Loading profile…</div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-semibold text-black/80">
                      First Name
                    </label>
                    <input
                      value={profileFirstName}
                      onChange={(e) => setProfileFirstName(e.target.value)}
                      className="mt-2 w-full rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-black/15 focus:outline-none focus:ring-2"
                      style={{ outlineColor: "#00f9ef" }}
                      placeholder="First name"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-black/80">
                      Last Name
                    </label>
                    <input
                      value={profileLastName}
                      onChange={(e) => setProfileLastName(e.target.value)}
                      className="mt-2 w-full rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-black/15 focus:outline-none focus:ring-2"
                      style={{ outlineColor: "#00f9ef" }}
                      placeholder="Last name"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-black/80">
                    GitHub URL
                  </label>
                  <input
                    value={profileGithubUrl}
                    onChange={(e) => setProfileGithubUrl(e.target.value)}
                    className="mt-2 w-full rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-black/15 focus:outline-none focus:ring-2"
                    style={{ outlineColor: "#00f9ef" }}
                    placeholder="https://github.com/your-handle"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-black/60">
                    Saved in Supabase table: <span className="font-mono">{PROFILES_TABLE}</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    disabled={profileSaving}
                    className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-extrabold text-black ring-1 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                    style={{
                      backgroundColor: "#00f9ef",
                      borderColor: "rgba(0,0,0,0.15)",
                    }}
                  >
                    <FaSave />
                    {profileSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Edit modal (white glass) */}
      {editOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditOpen(false);
          }}
        >
          <div className="w-full max-w-2xl rounded-2xl bg-white/90 p-6 text-black shadow-2xl ring-1 ring-black/10 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-extrabold">Edit submission</div>
                <div className="mt-1 text-sm text-black/60">
                  Update text and manage files.
                </div>
              </div>

              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="rounded-lg bg-black/5 px-3 py-2 text-xs font-bold ring-1 ring-black/10 hover:bg-black/10"
                aria-label="Close edit modal"
              >
                <FaTimes />
              </button>
            </div>

            {formError ? (
              <div className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-700 ring-1 ring-red-500/20">
                {formError}
              </div>
            ) : null}

            <div className="mt-5 space-y-4">
              <div>
                <label className="text-sm font-semibold text-black/80">
                  Work Title
                </label>
                <input
                  value={workTitle}
                  onChange={(e) => setWorkTitle(e.target.value)}
                  className="mt-2 w-full rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-black/15 focus:outline-none focus:ring-2"
                  style={{ outlineColor: "#00f9ef" }}
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-black/80">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-2 min-h-[130px] w-full resize-y rounded-xl bg-white px-4 py-3 text-sm ring-1 ring-black/15 focus:outline-none focus:ring-2"
                  style={{ outlineColor: "#00f9ef" }}
                />
              </div>

              <div className="rounded-2xl bg-black/5 p-4 ring-1 ring-black/10">
                <div className="text-sm font-bold text-black/70">Existing files</div>
                <div className="mt-2 space-y-2">
                  {(tasks.find((t) => t.id === editingId)?.attachments || []).length === 0 ? (
                    <div className="text-sm text-black/60">No files attached.</div>
                  ) : (
                    (tasks.find((t) => t.id === editingId)?.attachments || []).map((a) => {
                      const removing = editRemoving.has(a.path);
                      return (
                        <div
                          key={a.path}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-black/10"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{a.name || "file"}</div>
                            <div className="mt-0.5 text-xs text-black/60">
                              {a.contentType || "file"}{" "}
                              {typeof a.size === "number" ? `• ${Math.round(a.size / 1024)} KB` : ""}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleDownload(a)}
                              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ring-1 ring-black/10 hover:bg-black/5"
                              aria-label={`Download ${a.name || "file"}`}
                              style={{ color: "#00f9ef" }}
                            >
                              <FaDownload />
                              Download
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setEditRemoving((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(a.path)) next.delete(a.path);
                                  else next.add(a.path);
                                  return next;
                                });
                              }}
                              className="inline-flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-bold text-red-700 ring-1 ring-red-500/20 hover:bg-red-500/15"
                              aria-label={removing ? "Undo remove" : "Mark for removal"}
                            >
                              <FaRegTrashAlt />
                              {removing ? "Undo" : "Remove"}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="mt-4">
                  <label className="text-sm font-semibold text-black/80">
                    Add new files
                  </label>
                  <input
                    type="file"
                    multiple
                    onChange={(e) => setFiles(Array.from(e.target.files || []))}
                    className="mt-2 block w-full text-sm text-black/70 file:mr-4 file:rounded-lg file:border-0 file:bg-black/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black hover:file:bg-black/15"
                  />
                  {files.length > 0 ? (
                    <div className="mt-2 text-xs text-black/60">
                      Selected: {files.map((f) => f.name).join(", ")}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="rounded-xl bg-black/5 px-4 py-2 text-sm font-bold text-black ring-1 ring-black/10 hover:bg-black/10"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={saveEditModalChanges}
                  disabled={formBusy}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-extrabold text-black ring-1 hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    backgroundColor: "#00f9ef",
                    borderColor: "rgba(0,0,0,0.15)",
                  }}
                >
                  <FaSave />
                  {formBusy ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
