import { AdvancedPanel } from '@/contours/users/components/UserDrawer/AdvancedPanel';
import { Box } from '@mantine/core';
import { DangerZone } from '@/contours/users/components/UserDrawer/DangerZone';
import { DeviceList } from '@/contours/users/components/UserDrawer/DeviceList';
import { DialCard } from '@/contours/users/components/UserDrawer/DialCard';
import { SubscriptionCard } from '@/contours/users/components/UserDrawer/SubscriptionCard';
import { FormColumn } from '@/contours/users/components/UserDrawer/FormColumn';
import { PreviewCard } from '@/contours/users/components/UserDrawer/PreviewCard';
import { WELL } from '@/contours/users/lib/colors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Props } from '@/contours/users/components/UserDrawer';
import type { UserForm } from '@/contours/users/components/UserDrawer/useUserForm';

/**
 * The two columns: what is being set on the left, what it produces on the
 * right, and Advanced spanning both underneath.
 *
 * This box is the only thing that scrolls. The page behind the modal keeps its
 * own scroll position, which is the whole point of the move: on a 900-high
 * screen the form runs out of room long before the roster does.
 */
export function DrawerBody({
  user,
  onResetTraffic,
  onRevoke,
  onDelete,
  ...ui
}: UserForm & Pick<Props, 'user' | 'onResetTraffic' | 'onRevoke' | 'onDelete'>) {
  const { t } = useTranslation();
  // The preview's pencils point back at the field they describe. Both live in
  // the form column now, so the button focuses rather than opens anything.
  const trafficRef = useRef<HTMLInputElement>(null);

  /** Whether the body is at either end of its own scroll, for the edge fades. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtTop(el.scrollTop <= 1);
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  }, []);
  const onScroll = measure;

  // Opening Advanced changes the height under a still form, so the fades have
  // to be re-checked on content growth, not on scrolling alone.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [measure, ui.advancedOpen, ui.isEdit]);

  const clash = ui.squadRoutingClash;
  const routingClash =
    // A per-user override settles the question, so the warning would be noise.
    clash && !ui.form.values.routingPreset
      ? clash
          .map((s) =>
            t('userDrawer.routingClashPair', {
              squad: s.name,
              preset: s.preset,
            }),
          )
          .join(', ')
      : null;

  return (
    <Box style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
    <Box
      ref={scrollRef}
      onScroll={onScroll}
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: '16px 18px 18px',
      }}
    >
      {/* Every block below keeps its own height. The body is a flex column, and
          a flex child shrinks before it overflows: with Advanced open the card
          was squeezed from 393px to 122 and its second half simply vanished,
          which read as a form that would not open. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 18,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <Box style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FormColumn {...ui} trafficRef={trafficRef} />
          {/* Only an account that exists has devices bound to it and a link
              already in someone's client. */}
          {ui.isEdit && user && (
            <>
              <DeviceList userId={user.id} limit={ui.form.values.hwidDeviceLimit} />
              {onRevoke && <SubscriptionCard user={user} onRevoke={onRevoke} />}
            </>
          )}
        </Box>
        <Box style={{ width: 352, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PreviewCard
            preview={ui.preview}
            trafficGb={ui.form.values.trafficLimitGb}
            strategy={ui.form.values.trafficLimitStrategy}
            expiresAt={ui.expiresAt}
            expireDays={ui.form.values.expireDays}
            routingPreset={ui.form.values.routingPreset}
            routingClash={routingClash}
            routingSource={ui.squadRoutingSource}
            isEdit={ui.isEdit}
            onEditTraffic={() => trafficRef.current?.focus()}
          />
          {/* What the preview counts, listed one line at a time so a support
              call can be answered with a single URI instead of the whole
              subscription. */}
          {ui.isEdit && <DialCard query={ui.endpointsQuery} />}
        </Box>
      </Box>

      <AdvancedPanel {...ui} user={user} />

      {ui.isEdit && user && onResetTraffic && onRevoke && onDelete && (
        <DangerZone
          user={user}
          onResetTraffic={onResetTraffic}
          onRevoke={onRevoke}
          onDelete={onDelete}
        />
      )}
    </Box>

      {/* The panel hides its scrollbars, so a body that runs past the fold used
          to read as a form chopped in half. These say "there is more" and
          nothing else: they fade the last line rather than covering it, and
          they are gone the moment there is nothing left to reach. */}
      {!atTop && <Edge side="top" />}
      {!atBottom && <Edge side="bottom" />}
    </Box>
  );
}

function Edge({ side }: { side: 'top' | 'bottom' }) {
  return (
    <Box
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        [side]: 0,
        height: 28,
        pointerEvents: 'none',
        background: `linear-gradient(${side === 'top' ? 'to bottom' : 'to top'}, ${WELL}, ${WELL}00)`,
      }}
    />
  );
}
