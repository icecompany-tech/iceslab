import { api } from '@/lib/net/client';
import type { Fingerprint } from '@/lib/domain/protocols';

//
// One Binding can fan out into N Hosts in subscriptions. Each Host is a
// distinct URL with overrides for SNI / fingerprint / path / host-header /
// ALPN / etc. on top of the binding's base config.

export interface Host {
  id: string;
  bindingId: string;
  /**
   * Squads that hand this host out, and how many DISTINCT people that is.
   * Present on the list endpoint only.
   *
   * Counted server-side on purpose: one person can be in several squads, and
   * the squad list carries member counts rather than user ids, so there is
   * nothing here to deduplicate against. Adding them up read one person in two
   * squads as two people.
   */
  reach?: { squads: number; users: number };
  remark: string;
  priority: number;
  enabled: boolean;
  addressOverride: string | null;
  portOverride: number | null;
  sniOverride: string | null;
  hostHeaderOverride: string | null;
  pathOverride: string | null;
  fingerprintOverride: Fingerprint | null;
  alpn: string[];
  allowInsecure: boolean;
  securityLayer: 'default' | 'tls' | 'none';
  disableForFormats: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Two ways to say where a host lives, and the second is the one the create
 * screen uses.
 *
 * `bindingId` attaches to a binding that already exists. Nothing in this UI
 * creates bindings, so on a fresh install that path had no way to start.
 * `profileId` + `nodeId` + `port` says what the operator means, and the API
 * creates the binding in the same transaction as the host: a refused host
 * leaves no orphan behind, and no screen here lists bindings to clean up.
 */
export interface CreateHostInput {
  bindingId?: string;
  profileId?: string;
  nodeId?: string;
  /** Listen port for the binding. Required only when creating one. */
  port?: number;
  remark?: string;
  priority?: number;
  enabled?: boolean;
  addressOverride?: string | null;
  portOverride?: number | null;
  sniOverride?: string | null;
  hostHeaderOverride?: string | null;
  pathOverride?: string | null;
  fingerprintOverride?: Fingerprint | null;
  alpn?: string[];
  allowInsecure?: boolean;
  securityLayer?: 'default' | 'tls' | 'none';
  disableForFormats?: string[];
}

// The binding is immutable: moving a host to another node is a delete plus a
// create, not an edit.
export type UpdateHostInput = Partial<
  Omit<CreateHostInput, 'bindingId' | 'profileId' | 'nodeId' | 'port'>
>;

/** The port is taken on that node. The message names the profile holding it, so
 *  it is worth showing verbatim rather than replacing with "port busy". */
export function portConflict(err: unknown): string | null {
  const res = (err as { response?: { status?: number; data?: { message?: string } } }).response;
  if (res?.status !== 409) return null;
  return res.data?.message ?? '';
}

/** The profile or the node disappeared while the form was open. */
export function goneWhileEditing(err: unknown): boolean {
  return (err as { response?: { status?: number } }).response?.status === 404;
}

export async function listHosts(params?: {
  bindingId?: string;
  profileId?: string;
  nodeId?: string;
}): Promise<{ hosts: Host[] }> {
  const { data } = await api.get<{ hosts: Host[] }>('/api/hosts', { params });
  return data;
}

export async function createHost(input: CreateHostInput): Promise<Host> {
  const { data } = await api.post<Host>('/api/hosts', input);
  return data;
}

export async function updateHost(id: string, input: UpdateHostInput): Promise<Host> {
  const { data } = await api.put<Host>(`/api/hosts/${id}`, input);
  return data;
}

export async function deleteHost(id: string): Promise<void> {
  await api.delete(`/api/hosts/${id}`);
}

export async function reorderHosts(hostIds: string[]): Promise<{ hosts: Host[] }> {
  const { data } = await api.put<{ hosts: Host[] }>('/api/hosts/reorder', {
    hostIds,
  });
  return data;
}
