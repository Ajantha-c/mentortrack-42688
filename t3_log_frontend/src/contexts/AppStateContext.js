import React, { createContext, useContext, useMemo, useState } from "react";

/**
 * Lightweight global UI/data state bucket used to prevent cross-user "ghost" state
 * lingering in memory between sign-out/sign-in.
 *
 * NOTE:
 * - Notification system has been removed from the app (UI + logic), so this context
 *   no longer carries a notifications array.
 */

const AppStateContext = createContext(null);

// PUBLIC_INTERFACE
export function AppStateProvider({ children }) {
  /** Provides global app data state setters + a resetAll() helper. */
  const [tasks, setTasks] = useState([]);
  const [profile, setProfile] = useState(null);

  const value = useMemo(() => {
    return {
      tasks,
      setTasks,
      profile,
      setProfile,
      // PUBLIC_INTERFACE
      resetAll() {
        /**
         * Clears all app state that might otherwise remain in memory and leak across users.
         * This is used during sign-out and on SIGNED_OUT auth events.
         */
        setTasks([]);
        setProfile(null);
      },
    };
  }, [tasks, profile]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

// PUBLIC_INTERFACE
export function useAppState() {
  /** Hook to access global app state. */
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within <AppStateProvider />");
  return ctx;
}

export default AppStateContext;
