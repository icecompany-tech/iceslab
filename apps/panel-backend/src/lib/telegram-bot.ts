import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { getOverview } from '../modules/dashboard/dashboard.service.js';
import { getLogger } from './logger.js';
import { escapeMarkdown } from './telegram-notify.js';

/**
 * K3 - first-party lightweight operator Telegram bot.
 *
 * Read-only MVP: long-polls getUpdates and answers a few commands from the
 * SAME chat that already receives alerts (config.TELEGRAM_CHAT_ID) - so no new
 * config and only the operator can drive it. Commands:
 *   /status            - panel overview (users / nodes / traffic today)
 *   /user <username>   - that user's status, traffic, expiry, online
 *   /help              - command list
 *
 * Interactive CRUD and DB backup (needs pg_dump in the image) are deferred.
 * Built on the existing notify token; the loop is started from index.ts and
 * is a silent no-op when Telegram isn't configured.
 */

const TG_API = 'https://api.telegram.org';

export interface ParsedCommand {
  cmd: string;
  args: string[];
}

/** Parse a Telegram message into a command. Returns null for non-commands. */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.split(/\s+/);
  // Strip a trailing @botname (groups append it: "/status@MyBot").
  const cmd = parts[0]!.slice(1).split('@')[0]!.toLowerCase();
  if (!cmd) return null;
  return { cmd, args: parts.slice(1) };
}

function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

interface StatusOverview {
  users: { total: number; onlineNow: number };
  system: { onlineNodeCount: number; totalNodeCount: number };
  traffic: { todayBytes: number };
}

/** Markdown status message for /status. Pure + testable. */
export function formatStatusMessage(o: StatusOverview): string {
  return [
    '*Iceslab status*',
    `users: ${o.users.total} (${o.users.onlineNow} online)`,
    `nodes: ${o.system.onlineNodeCount}/${o.system.totalNodeCount} online`,
    `traffic today: ${humanBytes(o.traffic.todayBytes)}`,
  ].join('\n');
}

export interface UserSummary {
  username: string;
  status: string;
  usedBytes: number;
  limitBytes: number | null;
  expireAt: Date | null;
  onlineAt: Date | null;
}

/** Markdown message for /user. Pure + testable. */
export function formatUserMessage(u: UserSummary): string {
  const limit = u.limitBytes === null ? '∞' : humanBytes(u.limitBytes);
  const expire = u.expireAt ? u.expireAt.toISOString().slice(0, 10) : 'never';
  const online = u.onlineAt ? u.onlineAt.toISOString().slice(0, 16).replace('T', ' ') : 'never';
  return [
    `*${escapeMarkdown(u.username)}*`,
    `status: ${u.status}`,
    `traffic: ${humanBytes(u.usedBytes)} / ${limit}`,
    `expires: ${expire}`,
    `last online: ${online}`,
  ].join('\n');
}

const HELP = [
  '*Iceslab operator bot*',
  '/status - panel overview',
  '/user <username> - user details',
  '/help - this message',
].join('\n');

async function sendMessage(token: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`${TG_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    getLogger().warn({ err }, '[telegram-bot] sendMessage failed');
  }
}

async function handleCommand(parsed: ParsedCommand): Promise<string> {
  switch (parsed.cmd) {
    case 'start':
    case 'help':
      return HELP;
    case 'status': {
      const o = await getOverview();
      return formatStatusMessage(o);
    }
    case 'user': {
      const name = parsed.args[0];
      if (!name) return 'usage: /user <username>';
      const user = await prisma.user.findFirst({
        where: { username: name, deletedAt: null },
        include: { traffic: true },
      });
      if (!user) return `user "${name}" not found`;
      return formatUserMessage({
        username: user.username,
        status: user.status,
        usedBytes: user.traffic ? Number(user.traffic.usedTrafficBytes) : 0,
        limitBytes: user.trafficLimitBytes !== null ? Number(user.trafficLimitBytes) : null,
        expireAt: user.expireAt,
        onlineAt: user.traffic?.onlineAt ?? null,
      });
    }
    default:
      return 'unknown command - /help';
  }
}

interface TgUpdate {
  update_id: number;
  message?: { text?: string; chat?: { id?: number | string } };
}

/**
 * Start the long-polling loop. Returns a stop function. No-op (returns a stale
 * stopper) when Telegram isn't configured. Only messages from the configured
 * operator chat are acted on; everything else is ignored.
 */
export function startTelegramBot(): () => void {
  const token = config.TELEGRAM_BOT_TOKEN;
  const operatorChat = config.TELEGRAM_CHAT_ID;
  if (!token || !operatorChat) return () => {};

  let running = true;
  let offset = 0;

  const loop = async (): Promise<void> => {
    getLogger().info('[telegram-bot] operator bot started (long-polling)');
    while (running) {
      try {
        const res = await fetch(
          `${TG_API}/bot${token}/getUpdates?timeout=25&offset=${offset}&allowed_updates=["message"]`,
          { signal: AbortSignal.timeout(30000) },
        );
        const body = (await res.json()) as { ok: boolean; result?: TgUpdate[] };
        if (!body.ok || !body.result) continue;
        for (const upd of body.result) {
          offset = upd.update_id + 1;
          const text = upd.message?.text;
          const chatId = upd.message?.chat?.id;
          if (!text || chatId === undefined) continue;
          // Authorization: only the configured operator chat may drive the bot.
          if (String(chatId) !== String(operatorChat)) continue;
          const parsed = parseCommand(text);
          if (!parsed) continue;
          try {
            const reply = await handleCommand(parsed);
            await sendMessage(token, String(chatId), reply);
          } catch (err) {
            getLogger().warn({ err }, '[telegram-bot] command handler failed');
            await sendMessage(token, String(chatId), 'command failed');
          }
        }
      } catch (err) {
        // Network/timeout: brief backoff, then keep polling.
        getLogger().warn({ err }, '[telegram-bot] poll error, retrying');
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  void loop();
  return () => {
    running = false;
  };
}
