import React, { useEffect, useMemo, useState } from "react";
import { FaFileAlt, FaRegTrashAlt, FaRegEdit, FaDownload, FaUserCircle, FaSignOutAlt } from "react-icons/fa";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { downloadUrlAsFile } from "../utils/download";

/**
 * Intern Dashboard (T3 Log)
 * - Dark, bold "Ocean Professional" theme surface on teal/orange accents
 * - Profile modal (from Supabase user metadata)
 * - Submission form:
 *    - title, summary/notes, links, optional file uploads
 *    - automatic timestamping (created_at/updated_at)
 * - History list:
 *    - cards show content + attachments
 *    - download helper via blob download
 *    - edit/delete flows with storage cleanup
 *
 * Assumptions (per task): Supabase is the source of truth (auth + storage + data).
 * Backend OpenAPI spec provided does not expose additional endpoints, so this page talks directly to Supabase.
 */

const STORAGE_BUCKET = "t3log"; // NOTE: ensure this bucket exists in Supabase storage
const STORAGE_ROOT = "intern_submissions"; // folder prefix

function nowIso() {
  return new Date().toISOString();
}

function truncateMiddle(str, max = 42) {
  if (!str) return "";
  if (str.length <= max) return str;
  const keep = Math.floor((max - 3) / 2);
  return `${str.slice(0, keep)}...${str.slice(-keep)}`;
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function safeName(name) {
  return (name || "file").replace(/[^\w.\-]+/g, "_");
}

/**
 * RLS/data model note:
 * This dashboard expects a table `intern_submissions` with at least:
 * - id (uuid)
 * - user_id (uuid)
 * - title (text)
 * - notes (text)
 * - links (text) (optional)
 * - created_at (timestamptz)
 * - updated_at (timestamptz)
 * - attachments (jsonb) array of { path, name, size, contentType }
 *
 * If your table/bucket names differ, adjust constants above.
 */

async function ensureTableExistsHint() {
  // no-op placeholder for documentation; actual existence checks are best handled by migrations
  return true;
}

// PUBLIC_INTERFACE
export default function InternDashboard() {
  /** Main Intern Dashboard page. */
  const { user, loading: authLoading, signOut } = useAuth();

  const [profileOpen, setProfileOpen] = useState(false);

  const [submissions, setSubmissions] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(null);

  const [formMode, setFormMode] = useState("create"); // create | edit
  const [editingId, setEditingId] = useState(null);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState("");
  const [files, setFiles] = useState([]);
  const [formError, setFormError] = useState(null);
  const [formBusy, setFormBusy] = useState(false);

  const userDisplay = useMemo(() => {
    const md = user?.user_metadata || {};
    return {
      name: md.full_name || md.name || user?.email || "Intern",
      email: user?.email || "",
      avatar: md.avatar_url || "",
    };
  }, [user]);

  useEffect(() => {
    ensureTableExistsHint();
  }, []);

  useEffect(() => {
    if (!user) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function refresh() {
    setListError(null);
    setListLoading(true);

    try {
      const { data, error } = await supabase
        .from("intern_submissions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setSubmissions(data || []);
    } catch (e) {
      setListError(e?.message || "Failed to load submissions.");
    } finally {
      setListLoading(false);
    }
  }

  function resetForm() {
    setFormMode("create");
    setEditingId(null);
    setTitle("");
    setNotes("");
    setLinks("");
    setFiles([]);
    setFormError(null);
  }

  async function uploadAttachments({ submissionId, selectedFiles }) {
    if (!selectedFiles || selectedFiles.length === 0) return [];

    const uploaded = [];
    for (const f of selectedFiles) {
      const path = `${STORAGE_ROOT}/${user.id}/${submissionId}/${crypto.randomUUID()}_${safeName(f.name)}`;

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

  async function deleteAttachments(attachments) {
    if (!attachments || attachments.length === 0) return;

    const paths = attachments.map((a) => a.path).filter(Boolean);
    if (paths.length === 0) return;

    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    // If delete fails (missing files), do not block the DB delete; surface warning in console.
    if (error) {
      // eslint-disable-next-line no-console
      console.warn("[storage] remove failed:", error);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    if (!user) {
      setFormError("You must be signed in.");
      return;
    }
    if (!title.trim()) {
      setFormError("Please add a title.");
      return;
    }
    if (!notes.trim()) {
      setFormError("Please add your progress notes.");
      return;
    }

    setFormBusy(true);
    try {
      if (formMode === "create") {
        const createdAt = nowIso();

        // Create row first to get id (for structured storage path)
        const { data: inserted, error: insertError } = await supabase
          .from("intern_submissions")
          .insert([
            {
              user_id: user.id,
              title: title.trim(),
              notes: notes.trim(),
              links: links.trim() || null,
              created_at: createdAt,
              updated_at: createdAt,
              attachments: [],
            },
          ])
          .select("*")
          .single();

        if (insertError) throw insertError;

        const newAttachments = await uploadAttachments({
          submissionId: inserted.id,
          selectedFiles: files,
        });

        const { data: updated, error: updateError } = await supabase
          .from("intern_submissions")
          .update({
            attachments: newAttachments,
            updated_at: nowIso(),
          })
          .eq("id", inserted.id)
          .eq("user_id", user.id)
          .select("*")
          .single();

        if (updateError) throw updateError;

        setSubmissions((prev) => [updated, ...prev]);
        resetForm();
      } else {
        // edit mode: update text fields; optionally replace attachments by uploading new ones and deleting old ones
        const target = submissions.find((s) => s.id === editingId);
        if (!target) throw new Error("Cannot find submission to edit.");

        let nextAttachments = target.attachments || [];

        // If user picked new files, replace attachments set (simple + predictable UX)
        if (files.length > 0) {
          await deleteAttachments(target.attachments || []);
          nextAttachments = await uploadAttachments({
            submissionId: target.id,
            selectedFiles: files,
          });
        }

        const { data: updated, error: updateError } = await supabase
          .from("intern_submissions")
          .update({
            title: title.trim(),
            notes: notes.trim(),
            links: links.trim() || null,
            attachments: nextAttachments,
            updated_at: nowIso(),
          })
          .eq("id", target.id)
          .eq("user_id", user.id)
          .select("*")
          .single();

        if (updateError) throw updateError;

        setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        resetForm();
      }
    } catch (e) {
      setFormError(e?.message || "Failed to submit.");
    } finally {
      setFormBusy(false);
    }
  }

  function beginEdit(submission) {
    setFormMode("edit");
    setEditingId(submission.id);
    setTitle(submission.title || "");
    setNotes(submission.notes || "");
    setLinks(submission.links || "");
    setFiles([]);
    setFormError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDelete(submission) {
    if (!user) return;
    const ok = window.confirm("Delete this submission? This will also remove any uploaded files.");
    if (!ok) return;

    try {
      // storage cleanup first (best-effort)
      await deleteAttachments(submission.attachments || []);

      const { error } = await supabase
        .from("intern_submissions")
        .delete()
        .eq("id", submission.id)
        .eq("user_id", user.id);

      if (error) throw error;

      setSubmissions((prev) => prev.filter((s) => s.id !== submission.id));
      if (editingId === submission.id) resetForm();
    } catch (e) {
      alert(e?.message || "Failed to delete.");
    }
  }

  async function handleDownload(att) {
    try {
      // Prefer signed URL to avoid public bucket requirement.
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(att.path, 60); // 60s

      if (error) throw error;
      const url = data?.signedUrl;
      await downloadUrlAsFile(url, att.name || "attachment");
    } catch (e) {
      alert(e?.message || "Failed to download.");
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
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
              <span className="text-sm font-extrabold text-emerald-200">T3</span>
            </div>
            <div>
              <div className="text-sm text-white/60">Intern Dashboard</div>
              <div className="text-lg font-bold leading-tight">{userDisplay.name}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10"
            >
              <FaUserCircle />
              Profile
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

      {/* Main */}
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
                    Log your progress for mentorship review.
                  </p>
                </div>

                {formMode === "edit" ? (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-lg bg-white/5 px-3 py-2 text-xs font-bold ring-1 ring-white/10 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>

              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <div>
                  <label className="text-sm font-semibold text-white/80">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-2 w-full rounded-xl bg-black/40 px-4 py-3 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                    placeholder="e.g., Week 3: Completed onboarding + first feature"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-white/80">Progress notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-2 min-h-[140px] w-full resize-y rounded-xl bg-black/40 px-4 py-3 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                    placeholder="What did you do? What blockers? What next?"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-white/80">Links (optional)</label>
                  <input
                    value={links}
                    onChange={(e) => setLinks(e.target.value)}
                    className="mt-2 w-full rounded-xl bg-black/40 px-4 py-3 text-sm ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
                    placeholder="PRs, docs, tickets (comma-separated is fine)"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-white/80">
                    Attachments (optional)
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
                      Tip: selecting new files will replace existing attachments.
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
                  <FaFileAlt />
                  {formBusy ? "Saving…" : formMode === "create" ? "Submit log" : "Save changes"}
                </button>
              </form>
            </div>

            <div className="mt-4 rounded-2xl bg-gradient-to-br from-orange-500/15 to-black p-5 ring-1 ring-orange-500/20">
              <div className="text-sm font-bold text-orange-200">Automatic timestamping</div>
              <div className="mt-1 text-xs text-white/60">
                Created/updated time is recorded automatically on submission.
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
                onClick={refresh}
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
            ) : submissions.length === 0 ? (
              <div className="mt-6 rounded-2xl bg-white/5 p-6 text-sm text-white/70 ring-1 ring-white/10">
                No submissions yet. Create your first log on the left.
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {submissions.map((s) => (
                  <div key={s.id} className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-lg font-extrabold">{s.title}</div>
                        <div className="mt-1 text-xs text-white/50">
                          Created: {formatDateTime(s.created_at)}{" "}
                          {s.updated_at && s.updated_at !== s.created_at ? (
                            <> • Updated: {formatDateTime(s.updated_at)}</>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => beginEdit(s)}
                          className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs font-bold ring-1 ring-white/10 hover:bg-white/10"
                        >
                          <FaRegEdit />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(s)}
                          className="inline-flex items-center gap-2 rounded-xl bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200 ring-1 ring-red-500/20 hover:bg-red-500/20"
                        >
                          <FaRegTrashAlt />
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-white/80">
                      {s.notes}
                    </div>

                    {s.links ? (
                      <div className="mt-4">
                        <div className="text-xs font-bold text-white/60">Links</div>
                        <div className="mt-1 text-sm text-emerald-200/90">
                          {String(s.links)
                            .split(",")
                            .map((l) => l.trim())
                            .filter(Boolean)
                            .map((l) => (
                              <div key={l}>
                                <a
                                  href={l}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline decoration-emerald-500/40 underline-offset-4 hover:text-emerald-200"
                                >
                                  {truncateMiddle(l, 72)}
                                </a>
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : null}

                    {Array.isArray(s.attachments) && s.attachments.length > 0 ? (
                      <div className="mt-5">
                        <div className="text-xs font-bold text-white/60">Attachments</div>
                        <div className="mt-2 space-y-2">
                          {s.attachments.map((a) => (
                            <div
                              key={a.path}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-black/30 px-4 py-3 ring-1 ring-white/10"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{a.name}</div>
                                <div className="mt-0.5 text-xs text-white/50">
                                  {a.contentType || "file"} •{" "}
                                  {typeof a.size === "number" ? `${Math.round(a.size / 1024)} KB` : "—"}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDownload(a)}
                                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20"
                              >
                                <FaDownload />
                                Download
                              </button>
                            </div>
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

      {/* Profile modal */}
      {profileOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setProfileOpen(false);
          }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-neutral-950 p-6 ring-1 ring-white/10">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10">
                  {userDisplay.avatar ? (
                    // eslint-disable-next-line jsx-a11y/img-redundant-alt
                    <img src={userDisplay.avatar} alt="Profile avatar" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-white/50">
                      <FaUserCircle className="h-7 w-7" />
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-lg font-extrabold">{userDisplay.name}</div>
                  <div className="text-sm text-white/60">{userDisplay.email}</div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setProfileOpen(false)}
                className="rounded-lg bg-white/5 px-3 py-2 text-xs font-bold ring-1 ring-white/10 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="mt-5 rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
              <div className="text-xs font-bold text-white/60">User ID</div>
              <div className="mt-1 break-all text-sm text-white/80">{user.id}</div>
            </div>

            <div className="mt-3 text-xs text-white/50">
              Profile values come from your Google OAuth metadata in Supabase.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
