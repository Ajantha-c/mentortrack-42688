const DEFAULT_TIMEOUT_MS = 12_000;

// In CRA, only REACT_APP_* vars are exposed to the browser.
const BACKEND_BASE_URL =
  process.env.REACT_APP_BACKEND_URL ||
  process.env.REACT_APP_API_BASE_URL ||
  "http://localhost:3001";

/**
 * Basic JSON POST helper with timeout + friendly error messages.
 */
async function postJson(path, payload, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = new URL(path, BACKEND_BASE_URL).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The backend resolves recipients server-side via Supabase; no auth token required here.
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const detail =
        json?.detail ||
        json?.message ||
        (typeof text === "string" && text.trim() ? text.trim() : null) ||
        `HTTP ${res.status}`;
      throw new Error(`Email API error: ${detail}`);
    }

    return json;
  } finally {
    clearTimeout(timeout);
  }
}

// PUBLIC_INTERFACE
export async function sendInternNewTaskEmail({
  internId,
  mentorId,
  taskTitle,
  createdAt,
}) {
  /** Calls backend: POST /notifications/email/intern-new-task */
  if (!internId || !mentorId || !taskTitle) {
    throw new Error("Missing required fields for intern-new-task email.");
  }

  return postJson("/notifications/email/intern-new-task", {
    intern_id: internId,
    mentor_id: mentorId,
    task_title: taskTitle,
    created_at: createdAt || null,
  });
}

// PUBLIC_INTERFACE
export async function sendMentorUpdateEmail({
  internId,
  mentorId,
  taskTitle,
  status,
  remarks,
  meetingDatetime,
}) {
  /** Calls backend: POST /notifications/email/mentor-update */
  if (!internId || !mentorId || !taskTitle) {
    throw new Error("Missing required fields for mentor-update email.");
  }

  return postJson("/notifications/email/mentor-update", {
    intern_id: internId,
    mentor_id: mentorId,
    task_title: taskTitle,
    status: status ?? null,
    remarks: remarks ?? null,
    meeting_datetime: meetingDatetime ?? null,
  });
}
