/**
 * @file Small HTTP form body helpers shared across Express routers.
 */
import type { Request } from 'express';

/**
 * Reads a string field from a parsed form body, returning `''` when absent or non-string.
 * @param req - Incoming Express request.
 * @param name - Form field name.
 */
export function field(req: Request, name: string): string {
  const value: unknown = (req.body as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : '';
}
