import { isPlainXray, type SubscriptionEndpoint } from '../subscription.formats.js';

/**
 * Quantumult X server_local proxy-line list (`?format=quantumultx`). One
 * `type=host:port, ..., tag=name` line per endpoint.
 *
 * QX supports shadowsocks / vmess / vless / trojan, including REALITY (verified
 * against the official sample.conf 2026-06-12): TLS is `obfs=over-tls` +
 * `obfs-host=<sni>`, REALITY adds `reality-base64-pubkey` / `reality-hex-shortid`,
 * and VLESS Vision uses `vless-flow=`. QX has no hysteria2/wireguard, so those
 * endpoints are skipped.
 */
function safeTag(name: string): string {
  return name.replace(/[,=]/g, '-').trim();
}

export function buildQuantumultXConf(endpoints: SubscriptionEndpoint[]): string {
  const lines: string[] = [];
  for (const e of endpoints) {
    const tag = safeTag(e.nodeName);
    if (e.protocol === 'shadowsocks') {
      lines.push(`shadowsocks=${e.host}:${e.port}, method=${e.method}, password=${e.password}, udp-relay=true, tag=${tag}`);
    } else if (e.protocol === 'xray' && !isPlainXray(e)) {
      // socks/http (the Telegram doors) are carried by plain, clash, sing-box and
      // xray-json only, by decision of 23.09; this format leaves them out.
      const sec = e.securityLayer ?? 'default';
      const reality = sec === 'default';
      const tls = sec !== 'none';
      const sub = e.subprotocol ?? 'vless';
      const tlsParts = tls ? ['obfs=over-tls', `obfs-host=${e.sni}`] : [];
      const realityParts = reality
        ? [`reality-base64-pubkey=${e.publicKey}`, `reality-hex-shortid=${e.shortId}`]
        : [];
      if (sub === 'vless') {
        const p = [`vless=${e.host}:${e.port}`, 'method=none', `password=${e.uuid}`, ...tlsParts, ...realityParts];
        if (e.flow && tls) p.push(`vless-flow=${e.flow}`);
        p.push('udp-relay=true', `tag=${tag}`);
        lines.push(p.join(', '));
      } else if (sub === 'vmess') {
        const p = [`vmess=${e.host}:${e.port}`, 'method=none', `password=${e.uuid}`, ...tlsParts, ...realityParts, 'udp-relay=true', `tag=${tag}`];
        lines.push(p.join(', '));
      } else if (sub === 'trojan') {
        const p = [`trojan=${e.host}:${e.port}`, `password=${e.uuid}`, 'over-tls=true', `tls-host=${e.sni}`, ...realityParts, 'udp-relay=true', `tag=${tag}`];
        lines.push(p.join(', '));
      }
    }
    // hysteria / naive / mtproto / mieru / amneziawg -> skip (QX unsupported)
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}
