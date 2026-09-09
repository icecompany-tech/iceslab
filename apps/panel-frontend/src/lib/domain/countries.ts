/**
 * ISO 3166-1 alpha-2 country list, top hosting + VPN destinations.
 * Used by NodeFormModal's searchable Country picker.
 *
 * Flag emojis are the canonical Unicode regional-indicator pairs, most
 * modern OSes render them as flags; older Windows shows two-letter boxes
 * which is graceful degradation, the label text still says the name.
 */
export interface Country {
  code: string; // ISO alpha-2, uppercase
  name: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
  { code: 'AT', name: 'Austria', flag: '🇦🇹' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
  { code: 'BG', name: 'Bulgaria', flag: '🇧🇬' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'BY', name: 'Belarus', flag: '🇧🇾' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱' },
  { code: 'CN', name: 'China', flag: '🇨🇳' },
  { code: 'CY', name: 'Cyprus', flag: '🇨🇾' },
  { code: 'CZ', name: 'Czech Republic', flag: '🇨🇿' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
  { code: 'EE', name: 'Estonia', flag: '🇪🇪' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'FI', name: 'Finland', flag: '🇫🇮' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'GE', name: 'Georgia', flag: '🇬🇪' },
  { code: 'GR', name: 'Greece', flag: '🇬🇷' },
  { code: 'HK', name: 'Hong Kong', flag: '🇭🇰' },
  { code: 'HR', name: 'Croatia', flag: '🇭🇷' },
  { code: 'HU', name: 'Hungary', flag: '🇭🇺' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
  { code: 'IL', name: 'Israel', flag: '🇮🇱' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'IR', name: 'Iran', flag: '🇮🇷' },
  { code: 'IS', name: 'Iceland', flag: '🇮🇸' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'KZ', name: 'Kazakhstan', flag: '🇰🇿' },
  { code: 'LT', name: 'Lithuania', flag: '🇱🇹' },
  { code: 'LU', name: 'Luxembourg', flag: '🇱🇺' },
  { code: 'LV', name: 'Latvia', flag: '🇱🇻' },
  { code: 'MD', name: 'Moldova', flag: '🇲🇩' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
  { code: 'PL', name: 'Poland', flag: '🇵🇱' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
  { code: 'RO', name: 'Romania', flag: '🇷🇴' },
  { code: 'RS', name: 'Serbia', flag: '🇷🇸' },
  { code: 'RU', name: 'Russia', flag: '🇷🇺' },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'SI', name: 'Slovenia', flag: '🇸🇮' },
  { code: 'SK', name: 'Slovakia', flag: '🇸🇰' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
  { code: 'TW', name: 'Taiwan', flag: '🇹🇼' },
  { code: 'UA', name: 'Ukraine', flag: '🇺🇦' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
];

/** Mantine Select-friendly options: `{value, label}` with flag prefix. */
export const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({
  value: c.code,
  label: `${c.flag} ${c.name} (${c.code})`,
}));

export function countryFlag(code: string | null | undefined): string {
  if (!code) return '';
  const c = COUNTRIES.find((x) => x.code === code.toUpperCase());
  return c?.flag ?? '';
}

/** The country's own name, for places that name a direction rather than a node.
 *  Falls back to the code, which is still readable, rather than to nothing. */
export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  const upper = code.toUpperCase();
  return COUNTRIES.find((x) => x.code === upper)?.name ?? upper;
}
