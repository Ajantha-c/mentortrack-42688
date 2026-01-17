/**
 * Download helpers.
 * Uses fetch -> blob -> objectURL to ensure correct downloads even for signed URLs and CORS scenarios.
 */

// PUBLIC_INTERFACE
export async function downloadUrlAsFile(url, filename) {
  /** Downloads the URL as a file by fetching bytes and triggering a blob download. */
  if (!url) throw new Error("Missing download URL");

  const res = await fetch(url, {
    method: "GET",
    // credentials not needed for Supabase signed urls; keep default
  });

  if (!res.ok) {
    throw new Error(`Failed to download (${res.status})`);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename || "download";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
