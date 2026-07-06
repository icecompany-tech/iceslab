import { eventBus, type DomainEventMap } from '../../lib/event-bus.js';
import { emitWebhook } from '../../lib/webhook.js';

/**
 * K2: forward externally-meaningful domain events to the webhook bus.
 *
 * One subscriber; the events are already emitted onto the typed event bus by
 * the services, so there are no call-site changes. `inbound.*` and `binding.*`
 * are node-push plumbing (interesting to the node-agent, not to a billing bot),
 * so only the user / profile / node lifecycle is forwarded. Security/login and
 * node connection-lost/restored events live as ad-hoc telegram-notify calls
 * today; wiring those through the bus is a follow-up.
 */
function forward<K extends keyof DomainEventMap>(event: K): void {
  eventBus.on(event, (payload) => emitWebhook(event, payload));
}

export function registerWebhookEventHandlers(): void {
  forward('user.created');
  forward('user.updated');
  forward('user.status-changed');
  forward('user.deleted');
  forward('user.traffic-reset');
  forward('node.created');
  forward('profile.created');
  forward('profile.updated');
  forward('profile.deleted');
}
