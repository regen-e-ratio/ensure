import { Routes, Route } from "react-router-dom";
import { NoteEditor } from "./components/NoteEditor";
import { LoginPage } from "./pages/LoginPage";
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
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <NotePage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
