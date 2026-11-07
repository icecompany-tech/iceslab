import { csvList, numOr, type FormValues } from '@/contours/profiles/lib/profileFormValues';
import { isPlainSubprotocol, plainXrayConfig } from '@/contours/profiles/lib/plainSubprotocol';
import { portHopConfig } from '@/contours/profiles/lib/portHopRange';
import { awgHeaderConfig } from '@/contours/profiles/lib/awgHeaders';

/**
 * The profile's config as the form builds it on save, from the form's own
 * fields. Out of useProfileForm so the A-285 test can hold it to the shared
 * list of keys the form looks after (PROFILE_CONFIG_KEYS[protocol].form): the
 * server's PUT replaces the stored config whole, so a key with no field here
 * is erased by the next save unless the server keeps it or the push sets it.
 *
 * Shadowsocks: this is only the create shape; an edit goes through
 * ssConfigPatch (A-028).
 */
export function profileConfigOf(values: FormValues): Record<string, unknown> {
  switch (values.protocol) {
    case 'hysteria':
      return {
        ...(values.hyObfsPassword ? { obfsPassword: values.hyObfsPassword } : {}),
        ...(values.hyMasqueradeUrl ? { masqueradeUrl: values.hyMasqueradeUrl } : {}),
        ...(values.hyBrutalUp ? { brutalUpMbps: Number(values.hyBrutalUp) } : {}),
        ...(values.hyBrutalDown ? { brutalDownMbps: Number(values.hyBrutalDown) } : {}),
        // Every bound filled is sent: a half range is the form's to refuse
        // (useProfileForm validate) and the server's after it, never dropped (A-284).
        ...portHopConfig(values.hyPortHopStart, values.hyPortHopEnd),
      };
    case 'xray':
      // SOCKS5 / HTTP: a reality or transport key left from a vless draft
      // would be refused by the server, so none of them is sent.
      if (isPlainSubprotocol(values.xraySubprotocol)) return plainXrayConfig(values.xraySubprotocol);
      return {
        realityDest: values.xrayDest,
        realityServerNames: csvList(values.xrayServerNames),
        realityShortIds: csvList(values.xrayShortIds),
        realityPrivateKey: values.xrayPrivateKey,
        realityPublicKey: values.xrayPublicKey,
        realityMode: values.xrayRealityMode,
        // G1: realistic-fallback upstream is only meaningful for self-steal;
        // send '' otherwise so a stale value never trips the URL validation.
        realityFallbackUpstream:
          values.xrayRealityMode === 'self-steal' ? values.xrayRealityFallbackUpstream.trim() : '',
        flow: values.xrayFlow,
        fingerprint: values.xrayFingerprint,
        network: values.xrayNetwork,
        subprotocol: values.xraySubprotocol,
        security: values.xraySecurity,
        tlsServerName: values.xrayTlsServerName,
        tlsCert: values.xrayTlsCert,
        tlsKey: values.xrayTlsKey,
        ...(values.xrayPath ? { path: values.xrayPath } : {}),
        ...(values.xrayHostHeader ? { host: values.xrayHostHeader } : {}),
        ...(values.xrayServiceName ? { serviceName: values.xrayServiceName } : {}),
        // B3 advanced options - only emit the ones relevant to the chosen
        // security/network, mirroring how each tab gates its controls.
        ...(values.xraySecurity === 'reality'
          ? {
              realityXver: Number(values.xrayRealityXver),
              realityMaxTimeDiff: numOr(values.xrayRealityMaxTimeDiff, 0),
              // G: probe-resistance fallback rate-limit (bytes/sec, 0 = off).
              realityLimitFallbackUploadBytesPerSec: numOr(values.xrayRealityLimitFallbackUpload, 0),
              realityLimitFallbackDownloadBytesPerSec: numOr(values.xrayRealityLimitFallbackDownload, 0),
            }
          : {}),
        ...(values.xraySecurity === 'tls' ? { tlsRejectUnknownSni: values.xrayTlsRejectUnknownSni } : {}),
        ...(values.xrayNetwork === 'xhttp'
          ? {
              xhttpMode: values.xrayXhttpMode,
              xhttpPaddingBytes: values.xrayXhttpPaddingBytes.trim(),
            }
          : {}),
        ...(values.xrayNetwork === 'grpc' ? { grpcMultiMode: values.xrayGrpcMultiMode } : {}),
      };
    case 'amneziawg':
      return {
        subnet: values.awgSubnet,
        serverPrivateKey: values.awgServerPriv,
        serverPublicKey: values.awgServerPub,
        obfuscation: {
          jc: numOr(values.awgJc, 4),
          jmin: numOr(values.awgJmin, 64),
          jmax: numOr(values.awgJmax, 128),
          s1: numOr(values.awgS1, 32),
          s2: numOr(values.awgS2, 56),
          s3: numOr(values.awgS3, 32),
          s4: numOr(values.awgS4, 16),
          // Never 0: an empty header is the validator's to refuse (A-286).
          ...awgHeaderConfig(values),
          // I1-I5: optional v2.0 mimicry signature packets (hex).
          // Empty disables that slot. Trimmed defensively to avoid
          // accidental whitespace breaking awg-quick parser.
          i1: (values.awgI1 ?? '').trim(),
          i2: (values.awgI2 ?? '').trim(),
          i3: (values.awgI3 ?? '').trim(),
          i4: (values.awgI4 ?? '').trim(),
          i5: (values.awgI5 ?? '').trim(),
        },
      };
    case 'naive':
      return {
        hostname: values.naiveHostname,
        tlsEmail: values.naiveTlsEmail,
        masqueradeRoot: values.naiveMasquerade,
      };
    case 'shadowsocks':
      return { method: values.ssMethod };
    case 'mtproto':
      return { domain: values.mtgDomain };
    case 'mieru':
      return { mtu: values.mieruMtu === '' ? 1400 : Number(values.mieruMtu) };
    case 'tuic':
      return {
        serverName: values.tuicServerName,
        congestionControl: values.tuicCongestion,
      };
    case 'anytls':
      return { serverName: values.anytlsServerName };
    case 'shadowtls':
      return {
        handshake: values.shadowtlsHandshake,
        ssMethod: values.shadowtlsSsMethod,
      };
  }
}
