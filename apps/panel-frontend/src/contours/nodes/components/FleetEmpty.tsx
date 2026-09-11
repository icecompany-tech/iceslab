import { Box, Text, UnstyledButton } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { AMBER, CARD, CYAN, EDGE, HAIRLINE, MIST, RED, SNOW } from '@/contours/nodes/lib/colors';

const DISPLAY =
  "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * The nodes and the cascades screens with nothing in them.
 *
 * Four different nothings, and the day this matters is the day they are not
 * the same nothing. When /api/nodes answers 500 the list is empty exactly as it
 * is on a fresh install, and the old single line said "no nodes" to both: an
 * operator reads that as "my fleet is gone" or as "this is normal", and both
 * readings are wrong in a way that costs a night.
 *
 *   loading    nothing is claimed yet, so nothing is offered.
 *   failed     the request failed. The server sentence is printed as it came,
 *              and the only button retries. No "add a node" here: inviting
 *              someone to build a second fleet on top of one the panel merely
 *              cannot see is the worst thing this card could do.
 *   narrowed   the fleet exists, the filter hid it. Says how many are behind
 *              the filter and offers to drop it.
 *   blank      genuinely empty, so this is onboarding: what the thing is, and
 *              the one button that starts it.
 *
 * The dashed edge belongs to `blank` alone. That is the panel's way of saying
 * "a slot, not a failure", and a failure wearing it would lie in the frame
 * before anybody reads a word.
 */
export type FleetEmptyState =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string; onRetry: () => void }
  | { kind: 'narrowed'; hidden: number; onClear: () => void }
  | { kind: 'blank'; onCreate: () => void };

export function FleetEmpty({ what, state }: { what: 'nodes' | 'cascades'; state: FleetEmptyState }) {
  const { t } = useTranslation();
  const key = (suffix: string) => `fleetEmpty.${what}${suffix}`;

  if (state.kind === 'loading') {
    return (
      <Shell tone={HAIRLINE}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '19px', color: MIST }}>
          {t(key('Loading'))}
        </Text>
      </Shell>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Shell tone={`${RED}40`}>
        <Title tone={RED}>{t(key('FailedTitle'))}</Title>
        <Body>{t(key('FailedBody'))}</Body>
        {/* The server sentence, unedited. It is the only part of this card that
            says what actually went wrong. */}
        <Text
          style={{
            fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
            fontSize: 12,
            lineHeight: '17px',
            color: AMBER,
            maxWidth: 620,
            textAlign: 'center',
          }}
        >
          {state.message}
        </Text>
        <Button tone={RED} onClick={state.onRetry} label={t('fleetEmpty.retry')} />
      </Shell>
    );
  }

  if (state.kind === 'narrowed') {
    return (
      <Shell tone={HAIRLINE}>
        <Title tone={SNOW}>{t('fleetEmpty.narrowedTitle')}</Title>
        <Body>{t(key('NarrowedBody'), { count: state.hidden })}</Body>
        <Button tone={CYAN} onClick={state.onClear} label={t('fleetEmpty.clear')} />
      </Shell>
    );
  }

  return (
    <Shell tone={HAIRLINE} dashed>
      <Title tone={SNOW}>{t(key('BlankTitle'))}</Title>
      <Body>{t(key('BlankBody'))}</Body>
      <Button tone={CYAN} onClick={state.onCreate} label={t(key('BlankAction'))} />
    </Shell>
  );
}

function Shell({
  tone,
  dashed,
  children,
}: {
  tone: string;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: '64px 40px',
        borderRadius: 10,
        backgroundColor: CARD,
        border: `1px ${dashed ? 'dashed' : 'solid'} ${tone}`,
      }}
    >
      {children}
    </Box>
  );
}

function Title({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <Text style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 500, lineHeight: '24px', color: tone }}>
      {children}
    </Text>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: DISPLAY,
        fontSize: 13,
        lineHeight: '19px',
        color: MIST,
        maxWidth: 520,
        textAlign: 'center',
      }}
    >
      {children}
    </Text>
  );
}

function Button({ tone, label, onClick }: { tone: string; label: string; onClick: () => void }) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 34,
        paddingInline: 15,
        marginTop: 2,
        borderRadius: 8,
        backgroundColor: `${tone}14`,
        border: `1px solid ${tone === CYAN ? `${CYAN}33` : EDGE}`,
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, color: tone }}>{label}</Text>
    </UnstyledButton>
  );
}
