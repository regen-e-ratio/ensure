import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { ProtectedRoute } from "../../src/auth/ProtectedRoute";
import { AuthContext, type AuthContextValue } from "../../src/auth/useAuth";

function LoginProbe() {
  const location = useLocation();
  return <div>Login Page{location.search}</div>;
}

function renderGuard(value: AuthContextValue, initialEntries = ["/"]) {
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <div>Secret note</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const base: AuthContextValue = { user: null, loading: false, signOut: async () => {} };

describe("ProtectedRoute", () => {
  it("shows a loading state while auth is resolving", () => {
    renderGuard({ ...base, loading: true });
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    expect(screen.queryByText("Secret note")).not.toBeInTheDocument();
  });

  it("redirects unauthenticated users to /login?next=<path>", () => {
    renderGuard({ ...base, user: null });
    expect(screen.getByText(/login page/i)).toBeInTheDocument();
    // The originally requested path is preserved for post-login return.
    expect(screen.getByText(/login page/i)).toHaveTextContent("next=%2F");
    expect(screen.queryByText("Secret note")).not.toBeInTheDocument();
  });

  it("renders children when authenticated", () => {
    renderGuard({ ...base, user: { id: "u1", email: "u1@example.com", name: "U" } });
    expect(screen.getByText("Secret note")).toBeInTheDocument();
  });
});
