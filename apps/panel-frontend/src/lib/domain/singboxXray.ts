/**
 * The server's refusal of an xray-family profile on sing-box (0c7dcc7): the
 * agent renders it only as REALITY steal-others over raw, and the save names
 * the field that is not that.
 *
 * Three shapes, one meaning:
 *   create profile  400 VALIDATION_ERROR, issues[].path = ['config', field];
 *   edit profile    400 { error: 'INVALID', message, path: ['config', field] };
 *   binding POST/PUT the same 400 with path ['overrides', field].
 *
 * ⚠ The path alone is not enough: the socks/http refinement answers on
 * ['config', 'security'] too. The message is what tells them apart today
 * (it names sing-box); a code of its own from the server would be sturdier.
 *
 * The input is checked first: this reads a network error, and after
 * `as unknown` anything goes. `null` = not this refusal.
 */
export const SINGBOX_XRAY_FIELDS = ['security', 'realityMode', 'network'] as const;
export type SingboxXrayField = (typeof SINGBOX_XRAY_FIELDS)[number];

export interface SingboxXrayRefusal {
  where: 'config' | 'overrides';
  field: SingboxXrayField;
}

function fromPath(path: unknown, message: unknown): SingboxXrayRefusal | null {
  if (!Array.isArray(path) || path.length !== 2) return null;
  const [where, field] = path as unknown[];
  if (where !== 'config' && where !== 'overrides') return null;
  if (!(SINGBOX_XRAY_FIELDS as readonly unknown[]).includes(field)) return null;
  if (typeof message !== 'string' || !message.includes('sing-box')) return null;
  return { where, field: field as SingboxXrayField };
}

export function singboxXrayRefusal(err: unknown): SingboxXrayRefusal | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || res.status !== 400 || !res.data || typeof res.data !== 'object') return null;
  const data = res.data as { error?: unknown; message?: unknown; path?: unknown; issues?: unknown };
  if (Array.isArray(data.issues)) {
    for (const issue of data.issues) {
      if (!issue || typeof issue !== 'object') continue;
      const i = issue as { path?: unknown; message?: unknown };
      const hit = fromPath(i.path, i.message);
      if (hit) return hit;
    }
  }
  if (data.error === 'INVALID') return fromPath(data.path, data.message);
  return null;
}

/** The sentence for a refusal, one for every screen that can meet it. An
 *  override is the binding's own value, so it says so: the operator would
 *  otherwise look for the field on the profile and find it fine. */
export function singboxXrayMessage(
  r: SingboxXrayRefusal,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const field = t(`profileEdit.singboxXrayField.${r.field}`);
  return r.where === 'overrides'
    ? t('profileEdit.singboxXrayRefusedBinding', { field })
    : t('profileEdit.singboxXrayRefused', { field });
}
