import React, { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FaUser, FaGraduationCap } from "react-icons/fa";

/**
 * Landing page with role selection.
 * - Full-screen teal gradient background
 * - Two glassmorphism role cards (Intern/Mentor)
 * - Custom transition: clicking one role slides the opposite card out and fades a welcome+Google placeholder card into the vacated space
 */
// PUBLIC_INTERFACE
function App() {
  const [selectedRole, setSelectedRole] = useState(null); // "intern" | "mentor" | null

  const ui = useMemo(() => {
    const isInternSelected = selectedRole === "intern";
    const isMentorSelected = selectedRole === "mentor";

    // Which card disappears and which stays depends on what was clicked:
    // - click mentor => intern card slides left out, welcome appears on left
    // - click intern => mentor card slides right out, welcome appears on right
    const showInternRoleCard = !isMentorSelected; // mentor selected hides intern role card
    const showMentorRoleCard = !isInternSelected; // intern selected hides mentor role card

    const showLeftWelcome = isMentorSelected;
    const showRightWelcome = isInternSelected;

    return {
      showInternRoleCard,
      showMentorRoleCard,
      showLeftWelcome,
      showRightWelcome,
      isInternSelected,
      isMentorSelected,
    };
  }, [selectedRole]);

  // PUBLIC_INTERFACE
  const handlePickRole = (role) => {
    // Toggle behavior: click same role again returns to initial selection screen.
    setSelectedRole((prev) => (prev === role ? null : role));
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-teal-500 to-teal-700 text-white">
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-12">
        {/* Header */}
        <header className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/70">
            <span className="text-2xl font-bold tracking-wide">T3</span>
          </div>

          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
            Welcome to T3Log
          </h1>

          <p className="mt-3 max-w-2xl text-base font-semibold text-white/90 sm:text-lg">
            Precision Tracking. Seamless Mentorship. Elevated Growth.
          </p>
        </header>

        {/* Cards row */}
        <section className="mt-12 flex flex-1 items-start justify-center">
          <div className="grid w-full max-w-4xl grid-cols-1 gap-6 sm:grid-cols-2">
            {/* LEFT SLOT (Intern role card OR Mentor welcome card) */}
            <div className="relative">
              <AnimatePresence mode="wait" initial={false}>
                {ui.showInternRoleCard ? (
                  <motion.div
                    key="intern-role"
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -120 }}
                    transition={{ duration: 0.45, ease: "easeInOut" }}
                  >
                    <RoleCard
                      icon={<FaUser className="h-7 w-7" />}
                      title="I am an Intern"
                      description="Log progress, track tasks, and stay aligned with mentorship goals."
                      buttonText="Access Dashboard →"
                      onClick={() => handlePickRole("intern")}
                    />
                  </motion.div>
                ) : null}

                {ui.showLeftWelcome ? (
                  <motion.div
                    key="mentor-welcome-left"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: "easeInOut" }}
                  >
                    <WelcomeCard
                      title="Welcome to Mentor Dashboard"
                      subtitle="Sign in to review submissions and guide intern growth."
                      onBack={() => setSelectedRole(null)}
                      googleLabel="Sign in with Google"
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            {/* RIGHT SLOT (Mentor role card OR Intern welcome card) */}
            <div className="relative">
              <AnimatePresence mode="wait" initial={false}>
                {ui.showMentorRoleCard ? (
                  <motion.div
                    key="mentor-role"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 120 }}
                    transition={{ duration: 0.45, ease: "easeInOut" }}
                  >
                    <RoleCard
                      icon={<FaGraduationCap className="h-7 w-7" />}
                      title="I am a Mentor"
                      description="Review intern logs, give feedback, and manage mentorship progress."
                      buttonText="Review Submissions →"
                      onClick={() => handlePickRole("mentor")}
                    />
                  </motion.div>
                ) : null}

                {ui.showRightWelcome ? (
                  <motion.div
                    key="intern-welcome-right"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.45, ease: "easeInOut" }}
                  >
                    <WelcomeCard
                      title="Welcome to Intern Dashboard"
                      subtitle="Sign in to access your tasks, logs, and progress analytics."
                      onBack={() => setSelectedRole(null)}
                      googleLabel="Sign in with Google"
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

/**
 * Shared glassmorphism container styles.
 */
function GlassContainer({ children }) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 p-8 shadow-glass backdrop-blur-xl">
      {children}
    </div>
  );
}

/**
 * Role selection card.
 */
function RoleCard({ icon, title, description, buttonText, onClick }) {
  return (
    <GlassContainer>
      <div className="flex flex-col items-start">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
          <span className="text-white">{icon}</span>
        </div>

        <h2 className="mt-5 text-2xl font-bold">{title}</h2>

        <p className="mt-3 text-sm leading-relaxed text-white/85">
          {description}
        </p>

        <button
          type="button"
          onClick={onClick}
          className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-bold text-teal-700 transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/70 focus:ring-offset-2 focus:ring-offset-teal-700"
          aria-label={buttonText}
        >
          {buttonText}
        </button>
      </div>
    </GlassContainer>
  );
}

/**
 * Welcome card shown after role is selected (Google sign-in placeholder only).
 */
function WelcomeCard({ title, subtitle, googleLabel, onBack }) {
  return (
    <GlassContainer>
      <div className="flex flex-col items-start">
        <h2 className="text-2xl font-bold">{title}</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/85">{subtitle}</p>

        <button
          type="button"
          onClick={() => {
            // No auth yet, per requirements. This is a placeholder.
            // eslint-disable-next-line no-alert
            alert("Google authentication is not implemented yet.");
          }}
          className="mt-6 inline-flex w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/70 focus:ring-offset-2 focus:ring-offset-teal-700"
          aria-label={googleLabel}
        >
          <GoogleGMark />
          <span>{googleLabel}</span>
        </button>

        <button
          type="button"
          onClick={onBack}
          className="mt-4 text-sm font-semibold text-white/80 underline-offset-4 hover:text-white hover:underline"
        >
          Back to role selection
        </button>
      </div>
    </GlassContainer>
  );
}

/**
 * Minimal Google "G" mark (inline SVG) to make the button feel high-fidelity without implementing auth.
 */
function GoogleGMark() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.33 1.53 7.79 2.82l5.68-5.68C34.05 3.33 29.53 1 24 1 14.61 1 6.51 6.39 2.68 14.2l6.63 5.15C11.04 13.5 17.07 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.5 24.5c0-1.57-.14-3.08-.4-4.5H24v8.53h12.67c-.55 2.96-2.21 5.47-4.7 7.15l7.18 5.58C43.52 37.19 46.5 31.43 46.5 24.5z"
      />
      <path
        fill="#FBBC05"
        d="M9.31 28.85A14.98 14.98 0 0 1 8.5 24c0-1.68.29-3.3.81-4.85L2.68 14.2A23.94 23.94 0 0 0 0 24c0 3.88.93 7.55 2.68 10.8l6.63-5.95z"
      />
      <path
        fill="#34A853"
        d="M24 47c5.53 0 10.18-1.82 13.57-4.94l-7.18-5.58c-2 1.34-4.56 2.12-6.39 2.12-6.93 0-12.96-4-14.69-9.85l-6.63 5.95C6.51 41.61 14.61 47 24 47z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

export default App;
