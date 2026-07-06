import { z } from 'zod';

export const SrrFormat = z.enum([
  'plain',
  'json',
  'clash',
  'singbox',
  'wgconf',
  'xrayjson',
  'xkeen',
  'outline',
  'surge',
  'quantumultx',
  'loon',
]);

/**
 * Validate that a uaPattern compiles. Inline-flag prefix `(?i)` etc. is
 * stripped first to mirror the runtime matcher in srr.service.ts. We don't
 * try to enforce non-backtracking patterns, admins are trusted; the route
 * handler caps UA length to defang ReDoS.
 */
function validateUaPattern(value: string): boolean {
  const m = value.match(/^\(\?([imsux]+)\)([\s\S]*)$/);
  try {
    if (m) {
      new RegExp(m[2]!, m[1]!.replace(/[^ims]/g, ''));
    } else {
      new RegExp(value);
    }
    return true;
  } catch {
    return false;
  }
}

const UaPatternField = z
  .string()
  .min(1)
  .max(512)
  .refine(validateUaPattern, { message: 'Invalid regex pattern' });

export const CreateSrrSchema = z.object({
  name: z.string().min(1).max(64),
  uaPattern: UaPatternField,
  format: SrrFormat,
  priority: z.number().int().min(0).max(10000).optional().default(100),
  enabled: z.boolean().optional().default(true),
});

export type CreateSrrInput = z.infer<typeof CreateSrrSchema>;

export const UpdateSrrSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  uaPattern: UaPatternField.optional(),
  format: SrrFormat.optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  enabled: z.boolean().optional(),
});

export type UpdateSrrInput = z.infer<typeof UpdateSrrSchema>;

export const SrrIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const TestSrrSchema = z.object({
  /**
   * The User-Agent string to test against currently-enabled rules.
   * Returns the format that would be served, or `null` if no rule matched.
   */
  userAgent: z.string().min(1).max(512),
});

export type TestSrrInput = z.infer<typeof TestSrrSchema>;
