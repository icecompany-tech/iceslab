import { describe, expect, it } from 'vitest';
import { acmeHostnameFor } from './inbounds.queue.js';

// A hysteria client sends the address it dialled as its SNI and validates the
// certificate against it, and unlike xray it has no sniOverride to escape with.
// So the ACME name and the node address must be the same string. Deriving the
// name from anything else, the self-steal camouflage domain being the tempting
// candidate, issues a certificate for a name no client will ever ask for and
// drops every hysteria user on that node.

describe('acmeHostnameFor', () => {
  it('uses the node address, without its agent port', () => {
    expect(acmeHostnameFor('hy2.example.com:1337')).toBe('hy2.example.com');
    expect(acmeHostnameFor('hy2.example.com')).toBe('hy2.example.com');
  });

  it('normalises case so an unchanged address never looks like an edit', () => {
    // The node compares pushed config byte for byte to decide whether to
    // re-render and re-issue. Casing drift alone must not trigger that.
    expect(acmeHostnameFor('HY2.Example.COM:1337')).toBe('hy2.example.com');
  });

  it('declines an IP address, which no public CA will issue for', () => {
    // Asking hysteria to re-issue on a name that cannot be issued would cost it
    // the working certificate it already holds, so the node keeps its
    // install-time hostname instead.
    expect(acmeHostnameFor('203.0.113.9:1337')).toBeNull();
    expect(acmeHostnameFor('[2001:db8::1]:1337')).toBeNull();
    expect(acmeHostnameFor('2001:db8::1')).toBeNull();
  });

  it('declines a single-label name, which cannot be publicly resolvable', () => {
    expect(acmeHostnameFor('localhost:1337')).toBeNull();
    expect(acmeHostnameFor('node1')).toBeNull();
  });

  it('declines a missing address rather than emitting an empty domain', () => {
    expect(acmeHostnameFor(null)).toBeNull();
    expect(acmeHostnameFor(undefined)).toBeNull();
    expect(acmeHostnameFor('')).toBeNull();
    expect(acmeHostnameFor('   ')).toBeNull();
  });
});
