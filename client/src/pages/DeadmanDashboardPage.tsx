import { useState } from "react";
import { Link } from "react-router-dom";
import { DeadmanDashboard } from "../components/DeadmanDashboard";
import { OnboardingWizard } from "../components/OnboardingWizard";
import { DeadmanHelp } from "../components/DeadmanHelp";
import { clearWizardDismissed } from "../onboarding/firstRun";
import { useAuth } from "../auth/useAuth";

/**
 * The protected dead-man switch dashboard view (state, countdown, check-in, config, events).
 *
 * Feature 012: renders the dismissible, non-blocking onboarding wizard (offered on a derived
 * first-run) above the dashboard, plus the always-available "How this works" help affordance that
 * can relaunch the wizard on demand (reachable regardless of first-run state). The wizard decides
 * for itself whether to show — the page only supplies the relaunch override.
 */
export function DeadmanDashboardPage() {
  const { user, signOut } = useAuth();
  // Relaunch override: set when the help affordance asks to (re)open the guide, cleared on close.
  const [forceWizard, setForceWizard] = useState(false);

  function relaunchWizard() {
    // Allow the wizard to re-offer even if it was dismissed/already armed this session.
    clearWizardDismissed();
    setForceWizard(true);
  }

  return (
    <main>
      <header className="app-header">
        <h1>Dead-man switch</h1>
        <div className="app-header__account">
          {user ? <span className="meta">{user.email}</span> : null}
          <Link className="button button--ghost" to="/">
            Back to note
          </Link>
          <button type="button" className="button button--ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <DeadmanHelp onRelaunchWizard={relaunchWizard} />
      <OnboardingWizard forceOpen={forceWizard} onClose={() => setForceWizard(false)} />
      <DeadmanDashboard />
    </main>
  );
}
