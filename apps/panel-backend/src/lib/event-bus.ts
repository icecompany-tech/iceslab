import { EventEmitter } from 'node:events';
import { getLogger } from './logger.js';

/**
 * All domain events in the panel.
 *
 * Naming convention: '<entity>.<action>' (past tense).
 * When adding a new event, add it here with its payload type.
 */
export interface DomainEventMap {
  'user.created':         { userId: string; username: string };
  'user.updated':         { userId: string; changes: string[] };
  'user.status-changed':  { userId: string; from: string; to: string };
  'user.deleted':         { userId: string };
  'user.traffic-reset':   { userId: string; previousUsedBytes: bigint };
  // node.created → backfill all active users to this node. Required because
  // an empty new node otherwise stays empty until each existing user is
  // mutated again. Caught live during slice-23 VPS test 2026-05-06.
  'node.created':         { nodeId: string; nodeName: string };
  // node.updated → a node field that changes the pushed config (currently the
  // self-steal REALITY domain) was edited; re-push the inbound set so the live
  // node config matches. Without this a Node.domain edit only self-heals on an
  // unrelated binding/profile edit or an agent restart. Caught in review 2026-06-17.
  'node.updated':         { nodeId: string; nodeName: string };
  // inbound.* → push the full inbound set of the affected node to its
  // node-agent over mTLS, so the protocol server (xray/hysteria/awg/naive)
  // gets the live config without admin SSH editing /etc/iceslab-node/env.
  // Slice 24: replaces the manual env-editing dance from VPS test 2026-05-06.
  'inbound.created':      { inboundId: string; nodeId: string };
  'inbound.updated':      { inboundId: string; nodeId: string };
  'inbound.deleted':      { inboundId: string; nodeId: string };
  // Slice 27: Profiles + ProfileNodeBinding model. profile.* events fire
  // on profile-template mutations (no immediate node restart, config of
  // shared profile changed, all bound nodes need re-push). binding.* events
  // are scoped to a single node (only that node gets re-pushed).
  'profile.created':      { profileId: string };
  'profile.updated':      { profileId: string };
  'profile.deleted':      { profileId: string; affectedNodeIds: string[] };
  'binding.created':      { bindingId: string; profileId: string; nodeId: string };
  'binding.updated':      { bindingId: string; profileId: string; nodeId: string };
  'binding.deleted':      { bindingId: string; profileId: string; nodeId: string };
  // cascade.changed → a cascade's hops/enabled state changed, or it was
  // deleted. Every node that IS now or WAS a hop needs its inbound set
  // re-pushed so the xray cascade fragments (link-in/out + routing rules) get
  // injected or removed. Without this, enabling a cascade only landed in the
  // DB and never reached the nodes until an unrelated profile/binding edit
  // fired a re-push. Caught live during the first cascade field test 2026-06-17.
  'cascade.changed':      { nodeIds: string[] };
}

type EventHandler<K extends keyof DomainEventMap> = (
  payload: DomainEventMap[K],
) => void | Promise<void>;

/**
 * Type-safe wrapper around node:events EventEmitter.
 * - `emit` and `on` are constrained to keys of DomainEventMap.
 * - Handler errors are caught and logged so they never crash the emitter.
 */
class DomainEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Allow many handlers without warnings
    this.emitter.setMaxListeners(50);
  }

  emit<K extends keyof DomainEventMap>(event: K, payload: DomainEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof DomainEventMap>(event: K, handler: EventHandler<K>): void {
    this.emitter.on(event, (payload: DomainEventMap[K]) => {
      void Promise.resolve()
        .then(() => handler(payload))
        .catch((err: unknown) => {
          getLogger().error({ err }, `[event-bus] handler for "${String(event)}" threw`);
        });
    });
  }
}

export const eventBus = new DomainEventBus();
