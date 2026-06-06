import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../api/http";
import { AuthContext, type User } from "./useAuth";

interface MeResponse {
  user: User;
}

/**
 * Loads the current user from `GET /api/auth/me` on mount (silently refreshing the
 * access token if needed) and exposes `user`, `loading`, and `signOut` to the app.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiFetch("/api/auth/me")
      .then(async (res) => {
        if (!active) return;
        if (res.ok) {
          const body = (await res.json()) as MeResponse;
          setUser(body.user);
        } else {
          setUser(null);
        }
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Clear local state regardless; ProtectedRoute then redirects to /login.
      setUser(null);
    }
  }, []);

  return <AuthContext.Provider value={{ user, loading, signOut }}>{children}</AuthContext.Provider>;
}
