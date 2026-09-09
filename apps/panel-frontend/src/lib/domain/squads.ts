import type { RoutingPresetId } from '@iceslab/shared';
import { api } from '@/lib/net/client';

/** A4 increment 2, per-cascade exit allow-list entry. */
export interface SquadExitAclEntry {
  cascadeId: string;
  exitNodeIds: string[];
}

export interface Squad {
  id: string;
  name: string;
  description: string | null;
  /** Slice 27, squad ACL is profile-level. Renamed from inboundIds. */
  profileIds: string[];
  /** A4 increment 2, per-cascade allowed exits. Empty = no exit restriction. */
  exitAcl: SquadExitAclEntry[];
  /** A4 ad-split, extra route-policies granted to this squad. Empty = plain only. */
  policyIds: string[];
  /**
   * Which hosts of the granted profiles this squad hands out. Opt-in, like
   * `exitAcl`: EMPTY MEANS EVERY HOST, not none. A tier that should see two
   * countries while another sees all used to need a duplicated profile, which
   * meant different REALITY keys and a second inbound on every node.
   */
  hostIds: string[];
  /** R3-a, per-squad routing-preset override; null = inherit panel default. */
  routingPreset: RoutingPresetId | null;
  /** K7, per-squad HWID device-limit default; null = none. */
  hwidDeviceLimit: number | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSquadInput {
  name: string;
  description?: string | null;
  routingPreset?: RoutingPresetId | null;
  hwidDeviceLimit?: number | null;
  profileIds?: string[];
  exitAcl?: SquadExitAclEntry[];
  policyIds?: string[];
  hostIds?: string[];
}

export interface UpdateSquadInput {
  name?: string;
  description?: string | null;
  routingPreset?: RoutingPresetId | null;
  hwidDeviceLimit?: number | null;
  /** Replaces the full profile set when provided. */
  profileIds?: string[];
  /** Replaces the full exit allow-list when provided. */
  exitAcl?: SquadExitAclEntry[];
  /** Replaces the full route-policy grant set when provided. */
  policyIds?: string[];
  /**
   * Replaces the full host restriction when provided. Sending `[]` CLEARS the
   * restriction (back to every host); omitting the field leaves it as it was.
   * Those are different requests and the difference is the only way an operator
   * can undo a restriction.
   */
  hostIds?: string[];
}

export async function listSquads(): Promise<{ squads: Squad[] }> {
  const { data } = await api.get<{ squads: Squad[] }>('/api/squads');
  return data;
}

export async function createSquad(input: CreateSquadInput): Promise<Squad> {
  const { data } = await api.post<Squad>('/api/squads', input);
  return data;
}

export async function updateSquad(id: string, input: UpdateSquadInput): Promise<Squad> {
  const { data } = await api.put<Squad>(`/api/squads/${id}`, input);
  return data;
}

export async function deleteSquad(id: string): Promise<void> {
  await api.delete(`/api/squads/${id}`);
}
