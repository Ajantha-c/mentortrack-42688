import { supabase } from "./supabaseClient";

/**
 * Realtime subscription helper for the `tasks` table.
 *
 * This app uses Supabase Realtime (postgres_changes) to keep Mentor/Intern UIs
 * synchronized without manual refresh.
 */

const TASKS_TABLE = "tasks";

/**
 * NOTE ABOUT CHANNEL NAMING
 * Requirements specify using: supabase.channel('tasks-channel')
 * We therefore use a single shared channel name and optionally apply a row filter
 * at the postgres_changes subscription level.
 */

// PUBLIC_INTERFACE
export function subscribeToTasksChanges({
  /** optional: limit events to one intern user_id */
  userId,
  /** callback invoked for UPDATE events (and any others if enabled below) */
  onChange,
  /** optional callback when subscription state changes */
  onStatus,
  /** optional: which events to subscribe to. Default per requirements: UPDATE only */
  events = ["UPDATE"],
}) {
  /**
   * Subscribes to changes on `tasks`.
   *
   * Params:
   * - userId?: string - optional filter for user_id
   * - onChange: function(payload) - Supabase realtime payload
   * - onStatus?: function(status, err) - optional status updates
   * - events?: Array<"INSERT"|"UPDATE"|"DELETE"|"*"> - defaults to ["UPDATE"]
   *
   * Returns:
   * - { unsubscribe: () => Promise<void> }
   */
  if (typeof onChange !== "function") {
    throw new Error("subscribeToTasksChanges requires onChange(payload) callback");
  }

  // Required shared channel name.
  const channel = supabase.channel("tasks-channel");

  const filter = userId ? `user_id=eq.${userId}` : undefined;
  const uniqueEvents = Array.from(new Set(events && events.length ? events : ["UPDATE"]));

  for (const event of uniqueEvents) {
    channel.on(
      "postgres_changes",
      {
        event,
        schema: "public",
        table: TASKS_TABLE,
        ...(filter ? { filter } : {}),
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
  }

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
