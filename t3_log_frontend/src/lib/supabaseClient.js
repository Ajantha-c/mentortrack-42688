import { createClient } from "@supabase/supabase-js";

/**
 * IMPORTANT:
 * - In CRA, only env vars prefixed with REACT_APP_ are exposed to the browser.
 * - Never use Supabase service-role keys in the frontend.
 */
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey =
  process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly during development/CI so misconfiguration is obvious.
  // eslint-disable-next-line no-console
  console.error(
    "[supabase] Missing REACT_APP_SUPABASE_URL and/or REACT_APP_SUPABASE_ANON_KEY (or REACT_APP_SUPABASE_KEY)."
  );
}

// PUBLIC_INTERFACE
export const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // required for OAuth callback handling
  },
});

// PUBLIC_INTERFACE
export function roleToDashboardPath(role) {
  /** Maps the selected role to the canonical route. This app renders everything at "/". */
  if (role === "intern") return "/";
  if (role === "mentor") return "/";
  return "/";
}

const ROLE_STORAGE_KEY = "t3log:selected_role";

// PUBLIC_INTERFACE
export function persistSelectedRole(role) {
  /** Persist role across the OAuth redirect round-trip. */
  if (!role) return;
  try {
    localStorage.setItem(ROLE_STORAGE_KEY, role);
  } catch {
    // ignore storage errors (private mode, blocked storage, etc.)
  }
}

// PUBLIC_INTERFACE
export function readPersistedRole() {
  /** Read the stored role for role-based redirect after OAuth callback. */
  try {
    return localStorage.getItem(ROLE_STORAGE_KEY);
  } catch {
    return null;
  }
}
