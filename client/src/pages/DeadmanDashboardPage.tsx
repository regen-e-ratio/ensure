import { Link } from "react-router-dom";
import { DeadmanDashboard } from "../components/DeadmanDashboard";
import { useAuth } from "../auth/useAuth";

/** The protected dead-man switch dashboard view (state, countdown, check-in, config, events). */
export function DeadmanDashboardPage() {
  const { user, signOut } = useAuth();
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
      <DeadmanDashboard />
    </main>
  );
}
