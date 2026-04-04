import { Router } from "express";
import passport from "passport";
import { db } from "@workspace/db";
import { accessListTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isOwner } from "../lib/auth.js";

const router = Router();

// Kick off Google OAuth
router.get("/auth/google", passport.authenticate("google", { scope: ["email", "profile"] }));

// OAuth callback
router.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/?auth_error=1" }),
  (_req, res) => {
    res.redirect("/");
  }
);

// Logout
router.get("/auth/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
});

// Current user — includes role
router.get("/me", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user  = req.user as { email: string; name: string; picture: string };
  const email = user.email.toLowerCase();
  const owner = isOwner(email);

  let role = "viewer";
  if (owner) {
    role = "owner";
  } else {
    const [entry] = await db
      .select()
      .from(accessListTable)
      .where(eq(accessListTable.email, email))
      .limit(1);
    if (entry) role = entry.role;
    else {
      // Not in access list — deny
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  res.json({
    email:   user.email,
    name:    user.name,
    picture: user.picture,
    isOwner: owner,
    role,
  });
});

export default router;
