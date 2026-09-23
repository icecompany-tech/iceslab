import { isPlainXray, type SubscriptionEndpoint } from '../subscription.formats.js';

/**
 * Surge proxy-line list (`?format=surge`). One `Name = type, host, port, ...`
 * line per endpoint, ready to paste under Surge's `[Proxy]` section or import
 * as a proxy provider.
 *
 * Surge supports ss / vmess / trojan / hysteria2 but NOT vless and NOT REALITY
 * (verified manual.nssurge.com 2026-06-12). So REALITY-secured xray endpoints
 * (our common case) are skipped here - those clients use the xray/singbox/clash
 * formats instead. Surge meaningfully carries: shadowsocks, hysteria2, and xray
 * vmess/trojan over REAL TLS only.
 */
function safeName(name: string): string {
  return name.replace(/[,=]/g, '-').trim();
}

export function buildSurgeConf(endpoints: SubscriptionEndpoint[]): string {
  const lines: string[] = [];
  for (const e of endpoints) {
    const name = safeName(e.nodeName);
    if (e.protocol === 'shadowsocks') {
      lines.push(`${name} = ss, ${e.host}, ${e.port}, encrypt-method=${e.method}, password=${e.password}, udp-relay=true`);
    } else if (e.protocol === 'hysteria') {
      const p = [`${name} = hysteria2, ${e.host}, ${e.port}, password=${e.password}`];
      if (e.downMbps) p.push(`download-bandwidth=${e.downMbps}`);
      if (e.obfsPassword) p.push(`salamander-password=${e.obfsPassword}`);
      if (e.portHoppingStart && e.portHoppingEnd) {
        p.push(`port-hopping=${e.portHoppingStart}-${e.portHoppingEnd}`);
      }
      lines.push(p.join(', '));
    } else if (e.protocol === 'xray' && !isPlainXray(e)) {
      // socks/http (the Telegram doors) are carried by plain, clash, sing-box and
      // xray-json only, by decision of 23.09; this format leaves them out.
      const sec = e.securityLayer ?? 'default';
      // Surge cannot do REALITY; only emit xray endpoints over real TLS.
      if (sec === 'default') continue;
      const tls = sec === 'tls';
      const ws = e.network === 'ws';
      if (e.subprotocol === 'trojan') {
        const p = [`${name} = trojan, ${e.host}, ${e.port}, password=${e.uuid}`];
        if (tls) p.push(`sni=${e.sni}`);
        if (ws) p.push('ws=true', `ws-path=${e.path ?? '/'}`);
        if (e.allowInsecure) p.push('skip-cert-verify=true');
        lines.push(p.join(', '));
      } else if (e.subprotocol === 'vmess') {
        const p = [`${name} = vmess, ${e.host}, ${e.port}, username=${e.uuid}`, 'vmess-aead=true'];
        if (tls) p.push('tls=true', `sni=${e.sni}`);
        if (ws) p.push('ws=true', `ws-path=${e.path ?? '/'}`);
        if (e.allowInsecure) p.push('skip-cert-verify=true');
        lines.push(p.join(', '));
      }
      // subprotocol 'vless' -> skip (Surge unsupported)
    }
    // naive / mtproto / mieru / amneziawg -> skip (Surge unsupported)
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}
