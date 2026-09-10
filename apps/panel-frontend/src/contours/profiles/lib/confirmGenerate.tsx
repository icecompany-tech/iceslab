import { Stack, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import type { GenerateImpact } from '@/contours/profiles/lib/generateImpact';
import type { TFn } from '@/lib/ui/relativeTime';

/**
 * Ask before replacing a key pair, with the same numbers the warning above the
 * button already showed.
 *
 * Deliberately not a plain "are you sure": the cost of this one is measured in
 * hosts and nodes, so the dialog repeats the measurement rather than asking
 * the operator to remember it from the row they just read.
 *
 * A profile that has never been deployed cannot break anything, so it is
 * generated straight away.
 */
export function confirmGenerate(impact: GenerateImpact, t: TFn, run: () => void): void {
  if (impact.hosts === 0 && impact.nodes === 0) {
    run();
    return;
  }

  modals.openConfirmModal({
    title: t('profiles.generate.confirmTitle'),
    children: (
      <Stack gap={8}>
        <Text size="sm">
          {t('profiles.generate.confirmBody', { hosts: impact.hosts, nodes: impact.nodes })}
        </Text>
        <Text size="sm" c="dimmed">
          {t('profiles.generate.body')}
        </Text>
      </Stack>
    ),
    labels: { confirm: t('profiles.generate.confirmAction'), cancel: t('common.cancel') },
    confirmProps: { color: 'red' },
    onConfirm: run,
  });
}
