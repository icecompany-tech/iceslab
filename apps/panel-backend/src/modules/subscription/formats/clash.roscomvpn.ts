const PROXY_GROUP = 'Auto';
const ROSCOMVPN_BASE = 'https://cdn.jsdelivr.net/gh/hydraponique';

type ProviderSpec = {
  name: string;
  behavior: 'domain' | 'ipcidr';
  repository: 'roscomvpn-geosite' | 'roscomvpn-geoip';
  file: string;
  interval?: number;
};

const PROVIDERS: readonly ProviderSpec[] = [
  {
    name: 'private-domains',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'private.mrs',
    interval: 2592000,
  },
  {
    name: 'category-ru',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'category-ru.mrs',
  },
  {
    name: 'whitelist',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'whitelist.mrs',
  },
  {
    name: 'microsoft',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'microsoft.mrs',
  },
  {
    name: 'apple',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'apple.mrs',
  },
  {
    name: 'google-play',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'google-play.mrs',
  },
  {
    name: 'github',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'github.mrs',
  },
  {
    name: 'youtube',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'youtube.mrs',
  },
  {
    name: 'telegram',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'telegram.mrs',
  },
  {
    name: 'twitch',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'twitch.mrs',
  },
  {
    name: 'pinterest',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'pinterest.mrs',
  },
  {
    name: 'category-ads',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'category-ads.mrs',
  },
  {
    name: 'win-spy',
    behavior: 'domain',
    repository: 'roscomvpn-geosite',
    file: 'win-spy.mrs',
  },
  {
    name: 'private-ips',
    behavior: 'ipcidr',
    repository: 'roscomvpn-geoip',
    file: 'private.mrs',
    interval: 2592000,
  },
  {
    name: 'direct-ips',
    behavior: 'ipcidr',
    repository: 'roscomvpn-geoip',
    file: 'direct.mrs',
  },
];

const RULE_LINES: readonly string[] = [
  '  - RULE-SET,private-ips,DIRECT,no-resolve',
  '  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT',
  '  - RULE-SET,private-domains,DIRECT',
  '  - RULE-SET,category-ads,REJECT',
  '  - RULE-SET,win-spy,REJECT',
  '  - RULE-SET,google-play,Auto',
  '  - RULE-SET,youtube,Auto',
  '  - RULE-SET,telegram,Auto',
  '  - RULE-SET,github,Auto',
  '  - RULE-SET,twitch,DIRECT',
  '  - RULE-SET,microsoft,DIRECT',
  '  - RULE-SET,apple,DIRECT',
  '  - RULE-SET,pinterest,DIRECT',
  '  - RULE-SET,category-ru,DIRECT',
  '  - RULE-SET,whitelist,DIRECT',
  '  - RULE-SET,direct-ips,DIRECT,no-resolve',
];

function buildProviderLines(): string[] {
  const lines = ['rule-providers:'];
  for (const provider of PROVIDERS) {
    lines.push(
      `  ${provider.name}:`,
      '    type: http',
      `    behavior: ${provider.behavior}`,
      '    format: mrs',
      `    url: ${ROSCOMVPN_BASE}/${provider.repository}/release/mihomo/${provider.file}`,
      `    path: ./ruleset/roscomvpn-${provider.name}.mrs`,
      `    proxy: ${PROXY_GROUP}`,
      `    interval: ${provider.interval ?? 86400}`,
    );
  }
  return lines;
}

/**
 * Mihomo-only conservative subset of RoscomVPN. Iceslab keeps ownership of
 * proxy groups, so process, game and app-specific groups from the source
 * template are deliberately excluded.
 */
export function buildRoscomVpnSections(): {
  headerLines: string[];
  providerLines: string[];
  ruleLines: readonly string[];
} {
  return {
    headerLines: [
      'mode: rule',
      'ipv6: false',
      'dns:',
      '  enable: true',
      '  listen: 0.0.0.0:1053',
      '  ipv6: false',
      '  enhanced-mode: fake-ip',
      '  fake-ip-range: 198.18.0.1/16',
      '  fake-ip-filter:',
      '    - rule-set:private-domains',
      '    - "*.lan"',
      '    - "+.local"',
      '  default-nameserver:',
      '    - 77.88.8.8',
      '    - 1.1.1.1',
      '  proxy-server-nameserver:',
      '    - 1.1.1.1',
      '    - 8.8.8.8',
      '  direct-nameserver:',
      '    - 77.88.8.8',
      '    - 8.8.8.8',
      '  nameserver:',
      `    - https://1.1.1.1/dns-query#${PROXY_GROUP}`,
      `    - https://8.8.8.8/dns-query#${PROXY_GROUP}`,
      '',
    ],
    providerLines: buildProviderLines(),
    ruleLines: RULE_LINES,
  };
}
