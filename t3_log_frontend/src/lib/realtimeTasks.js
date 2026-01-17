import { supabase } from "./supabaseClient";

/**
 * Realtime subscription helper for the `tasks` table.
 *
 * This app uses Supabase Realtime (postgres_changes) to keep Mentor/Intern UIs
 * synchronized without manual refresh.
 */

const TASKS_TABLE = "tasks";

// PUBLIC_INTERFACE
export function subscribeToTasksChanges({
  /** userId filter: listen only to tasks for a specific intern */
  userId,
  /** callback invoked for INSERT/UPDATE/DELETE events */
  onChange,
  /** optional callback when subscription state changes */
  onStatus,
}) {
  /**
   * Subscribes to changes on `tasks` for a specific user_id.
   *
   * Params:
   * - userId: string (required) - the intern user_id whose tasks we care about
   * - onChange: function(payload) - Supabase realtime payload
   * - onStatus: function(status, err) - optional status updates
   *
   * Returns:
   * - { unsubscribe: () => Promise<void> }
   */
  if (!userId) {
    throw new Error("subscribeToTasksChanges requires userId");
  }
  if (typeof onChange !== "function") {
    throw new Error("subscribeToTasksChanges requires onChange(payload) callback");
  }

  // Use a stable, user-scoped channel name.
  const channel = supabase.channel(`tasks:user:${userId}`);

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: TASKS_TABLE,
      filter: `user_id=eq.${userId}`,
    },
    (payload) => {
      try {
        onChange(payload);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[realtime] onChange handler error:", e);
      }
    }
  );

  channel.subscribe((status, err) => {
    if (typeof onStatus === "function") onStatus(status, err);
    if (err) {
      // eslint-disable-next-line no-console
      console.warn("[realtime] subscribe error:", err);
    }
  });

  return {
    // PUBLIC_INTERFACE
    async unsubscribe() {
      /** Unsubscribes and removes the channel. */
      try {
        await supabase.removeChannel(channel);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[realtime] removeChannel failed:", e);
      }
    },
  };
}

function safeJsonParse(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
export function parseMeetingDetailsFromTask(taskRow) {
  /**
   * Tries to parse meeting schedule details from an existing task row.
   *
   * Because the schema is not fully specified, this function supports multiple
   * potential storage locations:
   * - taskRow.meeting_details (json or json-string)
   * - taskRow.meeting_agenda (string)
   * - taskRow.meeting_at / meeting_time / meeting_datetime (string)
   * - taskRow.meeting_scheduled_at (string)
   *
   * Returns:
   *  { datetime: string|null, agenda: string|null } | null
   */
  if (!taskRow || typeof taskRow !== "object") return null;

  const md = safeJsonParse(taskRow.meeting_details);
  if (md && (md.datetime || md.meeting_at || md.scheduled_at || md.agenda)) {
    const datetime =
      md.datetime || md.meeting_at || md.scheduled_at || md.meeting_datetime || null;
    const agenda = md.agenda || md.description || md.meeting_agenda || null;
    return { datetime: datetime || null, agenda: agenda || null };
  }

  const datetime =
    taskRow.meeting_scheduled_at ||
    taskRow.meeting_datetime ||
    taskRow.meeting_at ||
    taskRow.meeting_time ||
    null;

  const agenda = taskRow.meeting_agenda || taskRow.meeting_description || null;

  if (datetime || agenda) return { datetime: datetime || null, agenda: agenda || null };
  return null;
}
