import { AdvancedPanel } from '@/contours/users/components/UserDrawer/AdvancedPanel';
import { Box } from '@mantine/core';
import { FormColumn } from '@/contours/users/components/UserDrawer/FormColumn';
import { PreviewCard } from '@/contours/users/components/UserDrawer/PreviewCard';
import { useRef } from 'react';
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
export function DrawerBody({ user, ...ui }: UserForm & { user: Props['user'] }) {
  const { t } = useTranslation();
  // The preview's pencils point back at the field they describe. Both live in
  // the form column now, so the button focuses rather than opens anything.
  const trafficRef = useRef<HTMLInputElement>(null);

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
    <Box
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
      <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
        <Box style={{ flex: 1, minWidth: 320 }}>
          <FormColumn {...ui} trafficRef={trafficRef} />
        </Box>
        <Box style={{ width: 352, flexShrink: 0 }}>
          <PreviewCard
            preview={ui.preview}
            trafficGb={ui.form.values.trafficLimitGb}
            strategy={ui.form.values.trafficLimitStrategy}
            expiresAt={ui.expiresAt}
            expireDays={ui.form.values.expireDays}
            routingPreset={ui.form.values.routingPreset}
            routingClash={routingClash}
            onEditTraffic={() => trafficRef.current?.focus()}
          />
        </Box>
      </Box>

      <AdvancedPanel {...ui} user={user} />
    </Box>
  );
}
