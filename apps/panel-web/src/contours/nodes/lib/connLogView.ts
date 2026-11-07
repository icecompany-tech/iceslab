import type { ConnLogClearResponse as ConnLogClear, ConnLogSource, ConnLogTraceResponse as ConnLogTrace } from '@iceslab/shared';

/**
 * What the node page says about the connection log (owner's decision 26.10).
 *
 *   present   lines with clients' addresses are there, since the earliest one;
 *   none      every source checked clean, or not on the machine;
 *   unknown   nothing found, but a source could not be checked: said with its
 *             error, never as «clean».
 *
 * A source that is not on the machine (`absent`, syslog on most systemd
 * boxes) is a fact, not a failure. «Clear» is offered only when something
 * was found.
 */
export type ConnLogHeadline = { kind: 'present'; since: string | null } | { kind: 'none' } | { kind: 'unknown' };

export interface ConnLogLine {
  source: ConnLogSource;
  state: 'found' | 'clean' | 'absent' | 'failed';
  since: string | null;
  error: string | null;
}

export function connLogView(trace: ConnLogTrace): { headline: ConnLogHeadline; lines: ConnLogLine[]; canClear: boolean } {
  const headline: ConnLogHeadline =
    trace.present === true ? { kind: 'present', since: trace.since } : trace.present === false ? { kind: 'none' } : { kind: 'unknown' };
  return {
    headline,
    lines: trace.checks.map((c) => ({ source: c.source, state: c.state, since: c.since, error: c.error ?? null })),
    canClear: trace.present === true,
  };
}

/** The steps of a wipe that did not go through, with the node's words. */
export interface ConnLogClearFailure {
  source: ConnLogSource;
  command: string | null;
  error: string | null;
}

export function connLogClearFailures(r: ConnLogClear): ConnLogClearFailure[] {
  return r.results.flatMap((res): ConnLogClearFailure[] => {
    const failed = res.steps.filter((s) => !s.ok);
    if (failed.length > 0) return failed.map((s) => ({ source: res.source, command: s.command, error: s.error ?? null }));
    // A source said failed without a failed step is still a failure to name.
    return res.state === 'failed' ? [{ source: res.source, command: null, error: null }] : [];
  });
}
