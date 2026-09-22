import { randomBytes } from 'node:crypto';
import { prisma } from '../../prisma.js';

/**
 * The password a node's chain process asks for, and the one its user core
 * presents when it hands traffic over the loopback.
 *
 * PER NODE, which follows from the process rather than from taste: there is one
 * chain process on a machine whatever cascades run through it, so a node in two
 * cascades has one password and two sets of socks ports. A per-cascade secret
 * would mean one process holding two passwords for listeners it cannot tell
 * apart.
 *
 * ⚠ IT LEAVES THE PANEL IN EXACTLY ONE PLACE: the chain block pushed to the
 * node that owns it, over mTLS. It is not in any node DTO, it is not in the
 * public node shape the subscription reads, and the only way to read it back is
 * the acceptance endpoint, which sits behind the same admin auth as the
 * bootstrap token. That is the whole access surface, and it is small on
 * purpose: this password is what stands between a loopback socks proxy and
 * anyone else with a shell on that VPS.
 */

/** 32 bytes, the same size as the heartbeat secret. Long enough that guessing
 *  is not a strategy, short enough to sit in a config line. */
const SECRET_BYTES = 32;

/**
 * The secret for a node, minted on first use.
 *
 * Generated HERE rather than at node creation, and the difference matters for
 * the fleet that already exists: every node predating phase 4 has none, and a
 * node that never joins a cascade never needs one. Minting a credential for
 * machines that will never present it is a credential to look after for
 * nothing.
 *
 * Idempotent and safe against two renders racing: the write only fills a NULL,
 * and a loser re-reads the winner's value rather than overwriting it. Two
 * different passwords for one process would mean the node's core authenticating
 * against listeners that expect the other one.
 */
export async function chainSecretFor(nodeId: string): Promise<string> {
  const existing = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { chainSecret: true },
  });
  if (!existing) throw new Error(`no node ${nodeId} to mint a chain secret for`);
  if (existing.chainSecret) return toPassword(existing.chainSecret);

  const minted = randomBytes(SECRET_BYTES);
  // updateMany with a NULL guard, so the write is a compare-and-set rather than
  // a blind overwrite: `update` would happily replace a secret another render
  // minted a millisecond earlier, and then one half of the node would be using
  // a password the other half has never seen.
  const wrote = await prisma.node.updateMany({
    where: { id: nodeId, chainSecret: null },
    data: { chainSecret: minted },
  });
  if (wrote.count === 1) return toPassword(minted);

  const winner = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { chainSecret: true },
  });
  if (!winner?.chainSecret) throw new Error(`chain secret for node ${nodeId} vanished mid-write`);
  return toPassword(winner.chainSecret);
}

/**
 * How the bytes become the string both sides use.
 *
 * base64url rather than hex: it says the same 32 bytes in 43 characters instead
 * of 64, and it carries nothing that needs escaping in a JSON config or a
 * shell line. Fixed here so the panel and the node cannot disagree about the
 * spelling of one secret.
 */
function toPassword(secret: Uint8Array): string {
  return Buffer.from(secret).toString('base64url');
}

/**
 * Read the secret back, for acceptance on a stand.
 *
 * Returns null when the node has never rendered a chain, which is a real answer
 * and not an error: it means nothing has needed one yet.
 *
 * This exists because the field test has to check that the password the node's
 * core presents is the password its chain expects, and there is no other way to
 * see it: the config on the node holds it, and reading a file over ssh is
 * exactly the manual step this panel is supposed to remove. It never mints.
 */
export async function readChainSecret(nodeId: string): Promise<string | null> {
  const node = await prisma.node.findUnique({
    where: { id: nodeId },
    select: { chainSecret: true },
  });
  if (!node) throw new Error(`no node ${nodeId}`);
  return node.chainSecret ? toPassword(node.chainSecret) : null;
}
