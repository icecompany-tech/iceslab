const paths = {
  search: 'M11 4 A7 7 0 1 1 11 18 A7 7 0 1 1 11 4 Z M16 16 L20.5 20.5',
  filter: 'M3 5 H21 L14 13 V20 L10 18 V13 Z',
  cards: 'M4 4 H10 V10 H4 Z M14 4 H20 V10 H14 Z M4 14 H10 V20 H4 Z M14 14 H20 V20 H14 Z',
}

export function RegistryIcon({ name }: { name: keyof typeof paths }) {
  const size = name === 'search' ? 14 : 16
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}
