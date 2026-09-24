/**
 * The server's refusal of an xray-family profile on sing-box (0c7dcc7): the
 * agent renders it only as REALITY steal-others over raw, and the save names
 * the field that is not that.
 *
 * Two shapes, one code (SINGBOX_XRAY_FAMILY, 149968e):
 *   create profile   400 VALIDATION_ERROR, an issue with params.code and
 *                    path ['config', field];
 *   edit profile,    400 { error: 'SINGBOX_XRAY_FAMILY', message, path }, path
 *   bindings, hosts  ['config' | 'overrides', field].
 *
 * By the code and never by the path: the socks/http refusal answers on
 * ['config', 'security'] too, with INVALID.
 *
 * The input is checked first: this reads a network error, and after
 * `as unknown` anything goes. `null` = not this refusal.
 */
const CODE = 'SINGBOX_XRAY_FAMILY';

export const SINGBOX_XRAY_FIELDS = ['security', 'realityMode', 'network'] as const;
export type SingboxXrayField = (typeof SINGBOX_XRAY_FIELDS)[number];

export interface SingboxXrayRefusal {
  where: 'config' | 'overrides';
  field: SingboxXrayField;
}

function fromPath(path: unknown): SingboxXrayRefusal | null {
  if (!Array.isArray(path) || path.length !== 2) return null;
  const [where, field] = path as unknown[];
  if (where !== 'config' && where !== 'overrides') return null;
  if (!(SINGBOX_XRAY_FIELDS as readonly unknown[]).includes(field)) return null;
  return { where, field: field as SingboxXrayField };
}

export function singboxXrayRefusal(err: unknown): SingboxXrayRefusal | null {
  if (!err || typeof err !== 'object') return null;
  const res = (err as { response?: { status?: unknown; data?: unknown } }).response;
  if (!res || res.status !== 400 || !res.data || typeof res.data !== 'object') return null;
  const data = res.data as { error?: unknown; path?: unknown; issues?: unknown };
  if (data.error === CODE) return fromPath(data.path);
  if (Array.isArray(data.issues)) {
    for (const issue of data.issues) {
      if (!issue || typeof issue !== 'object') continue;
      const i = issue as { path?: unknown; params?: unknown };
      const params = i.params && typeof i.params === 'object' ? (i.params as { code?: unknown }) : null;
      if (params?.code !== CODE) continue;
      const hit = fromPath(i.path);
      if (hit) return hit;
    }
  }
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
