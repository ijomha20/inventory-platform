import { Router } from "express";
import passport from "passport";
import { isOwner } from "../lib/auth.js";

const router = Router();

// Kick off Google OAuth
router.get("/auth/google", passport.authenticate("google", { scope: ["email", "profile"] }));

// OAuth callback
router.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/?auth_error=1" }),
  (req, res) => {
    // Check if the logged-in user is on the access list
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

// Current user
router.get("/me", (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = req.user as { email: string; name: string; picture: string };
  res.json({
    email:   user.email,
    name:    user.name,
    picture: user.picture,
    isOwner: isOwner(user.email),
  });
});

export default router;
