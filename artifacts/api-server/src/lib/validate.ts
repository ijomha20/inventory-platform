/**
 * Express middleware factories for Zod schema validation.
 *
 * Exports:
 *   validateBody(schema)   — validates req.body, replaces it with parsed data
 *   validateQuery(schema)  — validates req.query, stores result on req.validatedQuery
 *   validateParams(schema) — validates req.params
 *
 * All return 400 with { error, details[] } on schema failure.
 * Use the generated schemas from @workspace/api-zod or inline Zod schemas.
 *
 * @example
 * ```ts
 * import { validateBody, validateQuery } from "../lib/validate.js";
 * import { z } from "zod";
 *
 * const BodySchema = z.object({ email: z.string().email() });
 * router.post("/foo", validateBody(BodySchema), (req, res) => {
 *   const { email } = req.body as z.infer<typeof BodySchema>;
 *   res.json({ email });
 * });
 *
 * const QuerySchema = z.object({ vin: z.string().length(17) });
 * router.get("/bar", validateQuery(QuerySchema), (req, res) => {
 *   const { vin } = req.validatedQuery as z.infer<typeof QuerySchema>;
 *   res.json({ vin });
 * });
 * ```
 *
 * Consumers: routes/access.ts, routes/inventory.ts, routes/lender/lender-calculate.ts
 */
import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      res.status(400).json({ error: "Validation failed", details });
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      res.status(400).json({ error: "Validation failed", details });
      return;
    }
    req.validatedQuery = result.data;
    next();
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      res.status(400).json({ error: "Validation failed", details });
      return;
    }
    next();
  };
}
