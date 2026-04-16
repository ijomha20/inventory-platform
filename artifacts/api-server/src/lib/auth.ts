import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { env } from "./env.js";

const OWNER_EMAIL   = env.OWNER_EMAIL;
const CLIENT_ID     = env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;

function getCallbackUrl(): string {
  const domain = env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) return `https://${domain}/api/auth/google/callback`;
  return "http://localhost:8080/api/auth/google/callback";
}

export function isOwner(email: string): boolean {
  return !!OWNER_EMAIL && email.toLowerCase() === OWNER_EMAIL;
}

export type UserRole = "owner" | "viewer" | "guest";

/** Resolve calling user's role. Returns null if user is not on the access list. */
export async function getUserRole(req: Request): Promise<UserRole | null> {
  const email = req.user!.email.toLowerCase();
  if (isOwner(email)) return "owner";
  const [entry] = await db
    .select()
    .from(accessListTable)
    .where(eq(accessListTable.email, email))
    .limit(1);
  if (!entry) return null;
  return (entry.role === "viewer" || entry.role === "guest") ? entry.role : "viewer";
}

/** Reject unauthenticated requests. */
function requireAuth(req: Request, res: Response): boolean {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}

/** Owner-only middleware. */
export async function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!requireAuth(req, res)) return;
  const role = await getUserRole(req);
  if (role !== "owner") {
    res.status(403).json({ error: "Owner only" });
    return;
  }
  next();
}

/** Owner or viewer — rejects users not on the access list. Sets req._role. */
export async function requireOwnerOrViewer(req: Request, res: Response, next: NextFunction) {
  if (!requireAuth(req, res)) return;
  const role = await getUserRole(req);
  if (role === null || (role !== "owner" && role !== "viewer")) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  req._role = role;
  next();
}

/** Any authenticated user on the access list (owner, viewer, or guest). */
export async function requireAccess(req: Request, res: Response, next: NextFunction) {
  if (!requireAuth(req, res)) return;
  const role = await getUserRole(req);
  if (role === null) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  next();
}

export function configurePassport() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    logger.warn("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google OAuth disabled");
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID:     CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        callbackURL:  getCallbackUrl(),
      },
      (_accessToken, _refreshToken, profile, done) => {
        const email = profile.emails?.[0]?.value ?? "";
        if (!email) return done(new Error("Google profile missing email"));
        const name    = profile.displayName ?? "";
        const picture = profile.photos?.[0]?.value ?? "";
        done(null, { email, name, picture });
      }
    )
  );

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user: unknown, done) => {
    if (user && typeof user === "object" && typeof (user as Record<string, unknown>).email === "string") {
      done(null, user as Express.User);
    } else {
      done(new Error("Invalid session data"));
    }
  });
}
