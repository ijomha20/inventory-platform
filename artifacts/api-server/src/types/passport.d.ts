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
    }
  }
}

export {};
