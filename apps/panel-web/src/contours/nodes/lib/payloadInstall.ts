/** Whether the answer says «install from the payload». Only a true is a yes. */
export function isPayloadOnly(info: { payloadOnly?: unknown } | null | undefined): boolean {
  return info?.payloadOnly === true;
}

/**
 * The path the command reads the payload from, taken from the command itself,
 * so the screen and the installer line cannot name two places. null when the
 * command has no --payload-file.
 */
export function payloadFileOf(command: string): string | null {
  return /--payload-file\s+(\S+)/.exec(command)?.[1] ?? null;
}

/** The name the downloaded payload is saved under. */
export function payloadFileName(nodeName: string): string {
  return `${nodeName}-payload.txt`;
}

/**
 * The copy to the node: the downloaded file to the path the command reads.
 * The host is the node's address without the agent port.
 */
export function scpCommand(nodeName: string, address: string, target: string): string {
  const host = address.replace(/:\d+$/, '');
  return `scp ./${payloadFileName(nodeName)} root@${host}:${target}`;
}

export function savePayload(name: string, payload: Blob) {
  const url = URL.createObjectURL(payload)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
