// National colours, not the panel's palette: the one place in code with literal hex, by the
// exception named in eslint.config.js (codex F6).
export interface FlagShape {
  kind: 'h' | 'v' | 'cross' | 'kz'
  colors: readonly string[]
}

const h = (...colors: string[]): FlagShape => ({ kind: 'h', colors })
const v = (...colors: string[]): FlagShape => ({ kind: 'v', colors })
const cross = (field: string, bar: string): FlagShape => ({ kind: 'cross', colors: [field, bar] })
// Board ui/Flag: the field, the sun and the hoist ornament as a bar of the sun's colour.
const kz = (field: string, sun: string): FlagShape => ({ kind: 'kz', colors: [field, sun] })

export const FLAGS: Readonly<Record<string, FlagShape>> = {
  AM: h('#D90012', '#0033A0', '#F2A800'),
  AT: h('#ED2939', '#FFFFFF', '#ED2939'),
  BE: v('#000000', '#FAE042', '#ED2939'),
  BG: h('#FFFFFF', '#00966E', '#D62612'),
  DE: h('#1A1A1A', '#DD0000', '#FFCE00'),
  DK: cross('#C8102E', '#FFFFFF'),
  EE: h('#0072CE', '#000000', '#FFFFFF'),
  FI: cross('#FFFFFF', '#003580'),
  FR: v('#0055A4', '#FFFFFF', '#EF4135'),
  HU: h('#CD2A3E', '#FFFFFF', '#436F4D'),
  ID: h('#FF0000', '#FFFFFF'),
  IE: v('#169B62', '#FFFFFF', '#FF883E'),
  IT: v('#009246', '#FFFFFF', '#CE2B37'),
  KZ: kz('#00AFCA', '#FEC50C'),
  LT: h('#FDB913', '#006A44', '#C1272D'),
  LU: h('#ED2939', '#FFFFFF', '#00A1DE'),
  LV: h('#9E3039', '#FFFFFF', '#9E3039'),
  NL: h('#AE1C28', '#F2F2F2', '#21468B'),
  NO: cross('#BA0C2F', '#FFFFFF'),
  PL: h('#FFFFFF', '#DC143C'),
  RO: v('#002B7F', '#FCD116', '#CE1126'),
  RU: h('#FFFFFF', '#0039A6', '#D52B1E'),
  SE: cross('#006AA7', '#FECC02'),
  UA: h('#0057B7', '#FFD700'),
}
