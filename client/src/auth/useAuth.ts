import { createContext, useContext } from "react";
import type { components } from "@ensure/shared/api";

export type User = components["schemas"]["User"];

export interface AuthContextValue {
  /** The signed-in user, or null when unauthenticated. */
  user: User | null;
  /** True while the initial `GET /api/auth/me` is resolving. */
  loading: boolean;
  /** Sign out: end the server session and clear local auth state. */
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Access the auth context. Throws if used outside an <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return ctx;
}
