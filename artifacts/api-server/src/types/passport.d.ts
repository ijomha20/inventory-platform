import type { UserRole } from "../lib/auth";

declare global {
  namespace Express {
    interface User {
      email:   string;
      name:    string;
      picture: string;
    }
    interface Request {
      _role?: UserRole;
      /**
       * Populated by validateQuery() middleware with the Zod-parsed query object.
       * Express 5 made req.query read-only, so we store validated data here instead.
       */
      validatedQuery?: unknown;
    }
  }
}

export {};
