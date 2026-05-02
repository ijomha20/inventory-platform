import pino from "pino";
import { env, isProduction } from "./env.js";
import type { PlatformError } from "./platformError.js";

const baseLogger = pino({
  level: env.LOG_LEVEL,
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

type FailureLogger = {
  failure: (error: PlatformError, message?: string) => void;
};

export const logger = Object.assign(baseLogger, {
  failure(error: PlatformError, message = "Platform failure") {
    baseLogger.error(
      {
        event: "platform_failure",
        subsystem: error.subsystem,
        reason: error.reason,
        recoverability: error.recoverability,
        payload: error.payload ?? null,
        causedBy: error.cause ? String(error.cause) : null,
      },
      `${message}: ${error.message}`,
    );
  },
}) as typeof baseLogger & FailureLogger;
