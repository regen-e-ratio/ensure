import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ACCESS_COOKIE } from "./cookies";
import { verifyAccessToken, type AuthUser } from "./tokens";

// Make the authenticated user available, typed, on every Express request.
declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Express middleware that verifies the access-token JWT from the `access_token`
 * cookie and attaches the typed `req.user`. A missing, invalid, or expired token
 * yields `401 { error: "UNAUTHORIZED" }` using the established error shape (D4).
 */
export function createRequireAuth(jwtSecret: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
    const user = token ? await verifyAccessToken(token, jwtSecret) : null;
    if (!user) {
      res.status(401).json({ error: "UNAUTHORIZED", message: "Sign in to continue." });
      return;
    }
    req.user = user;
    next();
  };
}
