import { eventBus, type DomainEventMap } from '../../lib/infra/event-bus.js';
import { emitWebhook } from '../../lib/notify/webhook.js';

/**
 * K2: forward externally-meaningful domain events to the webhook bus.
 *
 * One subscriber; the events are already emitted onto the typed event bus by
 * the services, so there are no call-site changes. `inbound.*` and `binding.*`
 * are node-push plumbing (interesting to the node-agent, not to a billing bot),
 * so only the user / profile / node lifecycle is forwarded.
 *
 * The four an operator's bot actually waits for are now all here: a node going
 * down or coming back (`node.status-changed`), a user expiring or hitting their
 * limit (`user.status-changed`, moved by the cron), and a counter reset
 * (`user.traffic-reset`). Before this, node liveness only reached a Telegram
 * chat, so a bot had to poll the panel to learn its own fleet was down.
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
  // Liveness. Carries from/to, so a receiver can tell "went down" from "came
  // back" without keeping state of its own.
  forward('node.status-changed');
  forward('node.deleted');
  forward('profile.created');
  forward('profile.updated');
  forward('profile.deleted');
}
