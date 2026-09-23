import { isPlainXray, type SubscriptionEndpoint } from '../subscription.formats.js';

/**
 * Loon proxy-line list (`?format=loon`). Comma-positional + colon-keyed params:
 * `Name = type,host,port,...,key:value`.
 *
 * Loon supports shadowsocks / vmess / vless / trojan / hysteria2 (incl. REALITY
 * via `public-key:` / `short-id:`). NOTE: unlike Surge/QX, Loon's exact
 * proxy-line grammar (especially the REALITY keys) could not be verified
 * upstream cleanly, so this builder is best-effort - validate the import in the
 * Loon app and file an issue if a field name drifted (alpha).
 */
function safeName(name: string): string {
  return name.replace(/[,=]/g, '-').trim();
}

export function buildLoonConf(endpoints: SubscriptionEndpoint[]): string {
  const lines: string[] = [];
  for (const e of endpoints) {
    const name = safeName(e.nodeName);
    if (e.protocol === 'shadowsocks') {
      lines.push(`${name} = Shadowsocks,${e.host},${e.port},${e.method},"${e.password}",udp=true`);
    } else if (e.protocol === 'hysteria') {
      const p = [`${name} = Hysteria2,${e.host},${e.port},"${e.password}"`];
      if (e.obfsPassword) p.push(`salamander-password:${e.obfsPassword}`);
      lines.push(p.join(','));
    } else if (e.protocol === 'xray' && !isPlainXray(e)) {
      // socks/http (the Telegram doors) are carried by plain, clash, sing-box and
      // xray-json only, by decision of 23.09; this format leaves them out.
      const sec = e.securityLayer ?? 'default';
      const reality = sec === 'default';
      const tls = sec !== 'none';
      const sub = e.subprotocol ?? 'vless';
      const net = e.network === 'ws' ? 'ws' : e.network === 'grpc' ? 'grpc' : 'tcp';
      if (sub === 'vless') {
        const p = [`${name} = VLESS,${e.host},${e.port},"${e.uuid}"`, `transport:${net}`];
        if (tls) p.push('over-tls:true', `tls-name:${e.sni}`);
        if (e.flow) p.push(`flow:${e.flow}`);
        if (reality) p.push(`public-key:${e.publicKey}`, `short-id:${e.shortId}`);
        lines.push(p.join(','));
      } else if (sub === 'vmess') {
        const p = [`${name} = vmess,${e.host},${e.port},auto,"${e.uuid}"`, `transport:${net}`];
        if (tls) p.push('over-tls:true', `tls-name:${e.sni}`);
        lines.push(p.join(','));
      } else if (sub === 'trojan') {
        const p = [`${name} = trojan,${e.host},${e.port},"${e.uuid}"`];
        if (tls) p.push(`tls-name:${e.sni}`);
        lines.push(p.join(','));
      }
    }
    // naive / mtproto / mieru / amneziawg -> skip (Loon unsupported)
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}
