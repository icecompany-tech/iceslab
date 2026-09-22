import { z } from 'zod';
import { FORMAT_NAMES } from '@iceslab/shared';

/**
 * Which format a rule may serve.
 *
 * ⚠ The SHARED list. This was its own copy of eleven names, missing
 * `xrayjson-array` and `amneziavpn`, so an operator could not write a rule for
 * two formats the subscription hands out every day: the route served them, the
 * rule editor refused them, and nothing said why (issue #41).
 *
 * A rule naming a format is only ever a NARROWING of what /sub already does, so
 * this list has no reason to be smaller than the one /sub accepts.
 */
export const SrrFormat = z.enum(FORMAT_NAMES);

/** Does the pattern compile as a RegExp? Mirrors the runtime matcher's
 *  inline-flag handling (`(?i)` prefix) in srr.service.ts. */
function compiles(value: string): boolean {
  const m = value.match(/^\(\?([imsux]+)\)([\s\S]*)$/);
  try {
    new RegExp(m ? m[2]! : value, m ? m[1]!.replace(/[^ims]/g, '') : '');
    return true;
  } catch {
    return false;
  }
}

/** The regex body without the inline-flag prefix, for the safety check. */
function patternBody(value: string): string {
  const m = value.match(/^\(\?[imsux]+\)([\s\S]*)$/);
  return m ? m[1]! : value;
}

/**
 * Reject patterns that risk catastrophic backtracking (ReDoS). V8's regex
 * engine backtracks, so a nested quantifier like `(a+)+` or `(.*)*` takes
 * exponential time on a short crafted input, and Node has no per-regex timeout,
 * so the UA-length cap does NOT defang it. This runs on the public `/sub` path
 * for every request, so a bad rule is a DoS vector; refuse it at save time.
 *
 * Best-effort heuristic (a full detector needs a parser): collapse innermost
 * groups and flag a quantified group whose body is itself quantified. Bounded
 * `{n,m}` counts too (nested repetition is slow even when not strictly
 * exponential). Existing pre-fix rules are not re-validated, so re2 / a worker
 * timeout remains the fully-robust future fix.
 */
export function hasNestedQuantifier(pattern: string): boolean {
  // Neutralise escaped chars and char classes so `\+` / `[+]` don't false-fire.
  let s = pattern.replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, 'C');
  const QUANT = /[*+]|\{\d*,\d*\}/;
  const INNER = /\(([^()]*)\)([*+]|\{\d*,\d*\})?/;
  for (let i = 0; i < 200; i++) {
    const m = s.match(INNER);
    if (!m) break;
    const bodyHasQuant = QUANT.test(m[1]!);
    if (m[2] && bodyHasQuant) return true; // quantified group with inner quantifier
    // Collapse this group, keeping a `+` marker when it carried any repetition
    // so an enclosing group still sees the nested quantifier after the collapse.
    s = s.replace(INNER, bodyHasQuant || m[2] ? '+' : 'x');
  }
  return false;
}

const UaPatternField = z
  .string()
  .min(1)
  .max(512)
  .refine(compiles, { message: 'Invalid regex pattern' })
  .refine((v) => !hasNestedQuantifier(patternBody(v)), {
    message:
      'Pattern risks catastrophic backtracking (a nested quantifier like (a+)+); simplify it',
  });

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
