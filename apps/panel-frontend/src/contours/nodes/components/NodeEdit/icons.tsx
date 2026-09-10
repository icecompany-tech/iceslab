export function LockIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

export function CircleMinusIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M8 12h8" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Each protocol keeps one accent across every screen it appears on. */

export function ServerIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="7" rx="2" fill="none" stroke={color} strokeWidth="1.7" />
      <rect x="3" y="13" width="18" height="7" rx="2" fill="none" stroke={color} strokeWidth="1.7" />
      <path d="M7 8h.01" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7 17h.01" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function GlobeIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="1.7" />
      <path d="M3 12h18" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path
        d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0 -18"
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChipIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="5" y="5" width="14" height="14" rx="1" fill="none" stroke={color} strokeWidth="1.6" />
      <rect x="9" y="9" width="6" height="6" fill="none" stroke={color} strokeWidth="1.6" />
      <path
        d="M3 10h2M3 14h2M19 10h2M19 14h2M10 3v2M14 3v2M10 19v2M14 19v2"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DbIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <ellipse cx="12" cy="6" rx="8" ry="3" fill="none" stroke={color} strokeWidth="1.6" />
      <path
        d="M4 6v6c0 1.7 3.6 3 8 3s8 -1.3 8 -3V6"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M4 12v6c0 1.7 3.6 3 8 3s8 -1.3 8 -3v-6"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DiskIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="14" r="2" fill="none" stroke={color} strokeWidth="1.6" />
      <path d="M14 4v4h-6v-4" fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function ChainIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="5.5" cy="18.5" r="2.5" fill="none" stroke={color} strokeWidth="2" />
      <circle cx="18.5" cy="5.5" r="2.5" fill="none" stroke={color} strokeWidth="2" />
      <path
        d="M5.5 16v-0.5a3.5 3.5 0 0 1 3.5 -3.5h6a3.5 3.5 0 0 0 3.5 -3.5v-0.5"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LinkIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M9 15l6-6M10.5 6.5l1.5-1.5a4.24 4.24 0 0 1 6 6l-1.5 1.5M7.5 12.5l-1.5 1.5a4.24 4.24 0 0 0 6 6l1.5-1.5"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function KeyIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="15" r="4" fill="none" stroke={color} strokeWidth="2" />
      <path d="M10.85 12.15L19 4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M18 5l2 2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M15 8l2 2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function TickIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M5 12l5 5L20 7"
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WarnIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 9v4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 17h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
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

export function ShieldIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrashIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M4 7h16" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M10 11v6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M14 11v6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2l1 -12"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 7v-2a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v2"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
