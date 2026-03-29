import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPg from "connect-pg-simple";
import passport from "passport";
import { pool } from "@workspace/db";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { configurePassport } from "./lib/auth.js";

const app: Express = express();
const PgSession = connectPg(session);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  })
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env["SESSION_SECRET"] ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env["NODE_ENV"] === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// Passport
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

app.use("/api", router);

export default app;
