import { Link } from "react-router-dom";
import { ContactList } from "../components/ContactList";
import { useAuth } from "../auth/useAuth";

/** The protected user settings view. For now its only section is the contact list. */
export function SettingsPage() {
  const { user, signOut } = useAuth();
  return (
    <main>
      <header className="app-header">
        <h1>Settings</h1>
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
      <ContactList />
    </main>
  );
}
