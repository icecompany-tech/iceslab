/**
 * Sidebar icons, traced from the Paper artboard. They are drawn here rather
 * than pulled from an icon set because the set's versions differ in weight and
 * in what each glyph depicts (a globe for hosts, a hourglass for queues), and
 * a nav column is exactly where those small differences are visible: eleven
 * marks sit in one vertical lane and any odd one out reads as a mistake.
 *
 * Everything strokes `currentColor`, so the active item tints the icon cyan
 * through the parent without a second colour prop.
 */

type IconProps = { size?: number };

function Svg({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

export function NavHomeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4h6v8h-6z" />
      <path d="M4 16h6v4h-6z" />
      <path d="M14 12h6v8h-6z" />
      <path d="M14 4h6v4h-6z" />
    </Svg>
  );
}

export function NavUsersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.85" />
    </Svg>
  );
}

// No squads icon here on purpose: the panel keeps its own (tabler's group of
// people). The artboard's three-nodes-on-a-stem mark reads as a topology, and
// a squad is a set of people, not a graph.

export function NavProfilesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4l-8 4l8 4l8-4z" />
      <path d="M4 12l8 4l8-4" />
      <path d="M4 16l8 4l8-4" />
    </Svg>
  );
}

export function NavHostsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0 -18" />
    </Svg>
  );
}

export function NavNodesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 8h.01" />
      <path d="M7 17h.01" />
    </Svg>
  );
}

export function NavMetadataIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4a16 16 0 0 1 16 16" />
      <path d="M4 11a9 9 0 0 1 9 9" />
      <circle cx="5" cy="19" r="1" />
    </Svg>
  );
}

export function NavRoutesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M5 8.5v4a3 3 0 0 0 3 3h8.8" />
      <path d="M9 6h9" />
    </Svg>
  );
}

export function NavDeliveryIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4h16v2.2a2 2 0 0 1-.6 1.4L15 12v7l-6-2v-5L4.6 7.6A2 2 0 0 1 4 6.2z" />
    </Svg>
  );
}

export function NavInsightsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 3v18h18" />
      <path d="M20 18v3" />
      <path d="M16 16v5" />
      <path d="M12 13v8" />
      <path d="M8 16v5" />
      <path d="M3 11c6 0 5-5 9-5s3 5 9 5" />
    </Svg>
  );
}

export function NavQueuesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3h12" />
      <path d="M6 21h12" />
      <path d="M6 3c0 6 6 5 6 9s-6 3-6 9" />
      <path d="M18 3c0 6-6 5-6 9s6 3 6 9" />
    </Svg>
  );
}

export function NavSettingsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37c1 .608 2.296.07 2.572-1.065z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function NavLogoutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2" />
      <path d="M9 12h12" />
      <path d="M18 9l3 3l-3 3" />
    </Svg>
  );
}

/**
 * Sliders, for the subscription's own settings screen. The cog is already
 * spoken for by the panel-wide settings at the foot of the nav, and two cogs
 * in one column read as the same destination twice.
 */
export function NavSlidersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <path d="M4 12h2" />
      <path d="M10 12h10" />
      <path d="M4 17h7" />
      <path d="M15 17h5" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="13" cy="17" r="2" />
    </Svg>
  );
}

/** Disclosure arrow on the one nav row that opens a sub-list. */
export function NavChevronIcon({ size = 13 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M6 9l6 6l6-6" />
    </Svg>
  );
}

export function NavCascadesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="4.5" cy="16" r="1.8" />
      <circle cx="19.5" cy="8" r="1.8" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M6.2 15.1l4.4-2.4" />
      <path d="M13.4 11.3l4.5-2.4" />
    </Svg>
  );
}

export function NavBillingIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <path d="M6.5 15h4" />
    </Svg>
  );
}

export function NavTemplateIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </Svg>
  );
}

export function NavSubscribePageIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 12s3.5-7 10-7s10 7 10 7s-3.5 7-10 7s-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function NavPoliciesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="6" cy="18" r="2.4" />
      <circle cx="18" cy="12" r="2.4" />
      <path d="M8.2 6.8c5 0 2.6 5.2 7.4 5.2" />
      <path d="M8.2 17.2c5 0 2.6-5.2 7.4-5.2" />
    </Svg>
  );
}

export function NavBlockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </Svg>
  );
}

export function NavRuleSetsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h16" />
      <path d="M4 12h11" />
      <path d="M4 18h7" />
      <circle cx="19" cy="12" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </Svg>
  );
}

export function NavEgressIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M3 12h11" />
      <path d="M10.5 8l4 4l-4 4" />
    </Svg>
  );
}

/**
 * Name resolution, drawn as a lookup that turns back on itself. The artboard
 * used a globe here, but hosts already owns the globe and two identical marks
 * in one column read as a slip rather than a pair.
 */
export function NavDnsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 8h10a4 4 0 0 1 0 8H8" />
      <path d="M11 13l-3 3l3 3" />
    </Svg>
  );
}

export function NavHwidIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 11a7 7 0 0 1 14 0" />
      <path d="M8 12a4 4 0 0 1 8 0v1" />
      <path d="M12 12v5" />
      <path d="M8.5 13v3" />
      <path d="M15.5 13.5v2" />
    </Svg>
  );
}

export function NavSearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20 20" />
    </Svg>
  );
}

export function NavShieldIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 2.5l7 3v5c0 4.5-3 7.5-7 9c-4-1.5-7-4.5-7-9v-5z" />
      <path d="M9 11.5l2 2l4-4" />
    </Svg>
  );
}

export function NavSessionIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M9 21h6" />
      <path d="M12 17v4" />
      <path d="M7 11l2.5 2.5L13 9l2 2" />
    </Svg>
  );
}

export function NavHttpStatsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M9 17v-5" />
      <path d="M14 17V8" />
      <path d="M19 17v-3" />
    </Svg>
  );
}
