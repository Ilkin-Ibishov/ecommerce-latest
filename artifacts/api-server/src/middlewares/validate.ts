import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";

// validate(schema): centralizes the request-body validation boilerplate that
// repeats across routes today (the `schema.safeParse(req.body)` → `400 { error }`
// pattern). On failure it short-circuits with the IDENTICAL `400 { error }` shape
// the inline checks emit. On success it attaches the parsed result to
// `req.validatedBody` (typed as `unknown`; routes narrow it via the schema type)
// and calls next().
export function validate<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    req.validatedBody = parsed.data;
    next();
  };
}
