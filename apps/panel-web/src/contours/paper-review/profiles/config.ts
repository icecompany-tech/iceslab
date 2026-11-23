import type { ProfileError } from '@/ui/CodeArea/text'
export const profileName = 'ru-reality'
export const original = [
  '{',
  '  "tag": "ru-reality",',
  '  "listen": "0.0.0.0",',
  '  "port": …,',
  '  "protocol": "vless",',
  '  "settings": {',
  '    "clients": […],',
  '    "decryption": "none"',
  '  },',
  '  "streamSettings": {',
  '    "network": "raw",',
  '    "security": "reality",',
  '    "realitySettings": {',
  '      "show": false,',
  '      "dest": "www.cloudflare.com:443",',
  '      "xver": 0,',
  '      "serverNames": ["www.cloudflare.com"],',
  '      "privateKey": "••••••••••••",',
  '      "shortIds": ["6ba85179e30d4fc2"]',
  '    }',
  '  },',
  '  "sniffing": {',
  '    "enabled": true,',
  '    "destOverride": ["http", "tls", "quic"],',
  '    "routeOnly": true',
  '  }',
  '}',
].join('\n')

export interface Revision { label: string; source: string; text: string }
export const older = original.replace(',\n    "routeOnly": true', '')
export const initialHistory: Revision[] = [
  { label: '4 ноя 18:20, admin', source: 'из формы', text: older },
  { label: '1 ноя 09:02, admin', source: 'откат к 28 окт 12:40', text: older.replace('"quic"', '"fakedns"') },
  { label: '28 окт 12:40, admin', source: 'рецепт REALITY + Vision', text: older.replace('["http", "tls", "quic"]', '["http", "tls"]') },
]



// The bullets and ellipses are the editor's display of panel-owned fields.
function parse(text: string) {
  return JSON.parse(text.replace(/^(\s*"port": )…/m, (_match, prefix: string) => prefix + '0').replace(/^(\s*"clients": )\[…\]/m, '$1[]'))
}

export function validate(text: string): ProfileError | null {
  try {
    const value = parse(text)
    const expected = parse(original)
    for (const key of ['tag','listen','port','clients','privateKey']) {
      const field = (config: typeof expected) => key === 'clients' ? config?.settings?.clients
        : key === 'privateKey' ? config?.streamSettings?.realitySettings?.privateKey : config?.[key]
      if (JSON.stringify(field(value)) !== JSON.stringify(field(expected))) {
        const line = text.split('\n').findIndex(row => row.includes('"' + key + '"'))
        return { line: Math.max(1, line + 1), column: 1, reason: 'Значение задаёт панель' }
      }
    }
    return null
  } catch (cause) {
    const lines = text.split('\n')
    const message = cause instanceof Error ? cause.message : ''
    const position = /position (\d+)/.exec(message)
    const reported = /line (\d+) column (\d+)/.exec(message)
    const prefix = text.slice(0, Number(position?.[1] ?? text.length)).split('\n')
    const line = Number(reported?.[1] ?? prefix.length)
    const prev = lines[line - 2]
    if (prev && /^\s*"[^"]+"\s*:/.test(lines[line - 1] ?? '') && /[\]"\d}e]\s*$/.test(prev)) {
      return { line: line - 1, column: prev.length + 1, reason: 'после значения нужна запятая' }
    }
    return { line, column: Number(reported?.[2] ?? prefix.at(-1)!.length + 1), reason: 'ошибка синтаксиса JSON' }
  }
}
