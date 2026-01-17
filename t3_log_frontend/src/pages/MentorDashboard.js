import MentorInternList from "./MentorInternList";

/**
 * MentorDashboard
 * Backwards-compatible export: mentor landing route now renders the intern list.
 */

// PUBLIC_INTERFACE
export default function MentorDashboard() {
  /** Mentor dashboard entrypoint. Currently shows the intern list for mentors. */
  return <MentorInternList />;
}
