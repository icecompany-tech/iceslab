export function WarnIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M12 9v4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 16h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M10.3 4.3l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7 -3l-8 -14a2 2 0 0 0 -3.4 0"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InfoIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M12 9h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M11 12h1v4h1"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}
