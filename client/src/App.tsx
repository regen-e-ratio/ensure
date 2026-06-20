import { Routes, Route, Link } from "react-router-dom";
import { NoteEditor } from "./components/NoteEditor";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotificationsTestPage } from "./pages/NotificationsTestPage";
import { DeadmanDashboardPage } from "./pages/DeadmanDashboardPage";
import { ContactVerifiedPage } from "./pages/ContactVerifiedPage";
import { ReleaseViewPage } from "./pages/ReleaseViewPage";
import { CheckedInPage } from "./pages/CheckedInPage";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { useAuth } from "./auth/useAuth";

/** The protected single-note view, with the signed-in identity and a sign-out control. */
function NotePage() {
  const { user, signOut } = useAuth();
  return (
    <main>
      <header className="app-header">
        <h1>Store a Note</h1>
        <div className="app-header__account">
          {user ? <span className="meta">{user.email}</span> : null}
          <Link className="button button--ghost" to="/deadman">
            Switch
          </Link>
          <Link className="button button--ghost" to="/settings">
            Settings
          </Link>
          <Link className="button button--ghost" to="/notifications">
            Notifications
          </Link>
          <button type="button" className="button button--ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <NoteEditor />
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Public verification-result page (feature 009) — no session required. */}
      <Route path="/contact-verified" element={<ContactVerifiedPage />} />
      {/* Public view-once release page (feature 010) — no session required. */}
      <Route path="/r/:token" element={<ReleaseViewPage />} />
      {/* Public passwordless check-in page (feature 011) — no session required. The reminder email
          links to /checkin?token=…; /checked-in is the same confirmation page. */}
      <Route path="/checkin" element={<CheckedInPage />} />
      <Route path="/checked-in" element={<CheckedInPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <NotePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/notifications"
        element={
          <ProtectedRoute>
            <NotificationsTestPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/deadman"
        element={
          <ProtectedRoute>
            <DeadmanDashboardPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
