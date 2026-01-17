/**
 * Download helpers for Supabase Storage.
 * Uses Supabase Storage `download(path)` to fetch a Blob and then forces a browser download.
 */

import { supabase } from "../lib/supabaseClient";

const TASK_FILES_BUCKET = "task-files";

/**
 * Attempt to infer a filename (with extension) from a storage path.
 * Falls back to provided filename if present.
 */
function inferFilenameFromPath(path, fallbackName) {
  if (fallbackName && String(fallbackName).trim()) return String(fallbackName).trim();
  const raw = String(path || "").split("?")[0];
  const last = raw.split("/").filter(Boolean).pop();
  return last || "download";
}

// PUBLIC_INTERFACE
export async function forceDownloadFromSupabaseStorage({ bucket, path, filename }) {
  /**
   * Downloads a file from Supabase Storage as a Blob and forces the browser to download it.
   *
   * Params:
   * - bucket: storage bucket name (default "task-files")
   * - path: full object path within the bucket
   * - filename: preferred filename to save as (optional)
   */
  const resolvedBucket = bucket || TASK_FILES_BUCKET;
  if (!path) throw new Error("Missing file path");

  const { data, error } = await supabase.storage.from(resolvedBucket).download(path);
  if (error) throw error;

  // Supabase returns a Blob
  const blob = data;
  const objectUrl = URL.createObjectURL(blob);

  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = inferFilenameFromPath(path, filename);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoke on a microtask to avoid rare cases where immediate revoke cancels the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
