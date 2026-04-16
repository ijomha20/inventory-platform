import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPg from "connect-pg-simple";
import passport from "passport";
import rateLimit from "express-rate-limit";
import { pool } from "@workspace/db";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { env, isProduction } from "./lib/env.js";
import { configurePassport } from "./lib/auth.js";

const app: Express = express();
const PgSession = connectPg(session);

// Trust Replit's proxy layer so express-rate-limit can identify clients correctly
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  })
);

const allowedOrigins = env.REPLIT_DOMAINS
  ? env.REPLIT_DOMAINS.split(",").map((d) => `https://${d}`)
  : undefined;
app.use(
  cors({
    origin: allowedOrigins ?? true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: false }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// Passport
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Rate limiting — 60 requests per minute per IP, applied to all API routes
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
  skip: (req) => req.path === "/healthz",
});

app.use("/api", apiLimiter);
app.use("/api", router);

// Global error handler — Express 5 propagates async rejections here automatically
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled route error");
  if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
});

export default app;
