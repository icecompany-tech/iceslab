import { notifications } from '@mantine/notifications';
import { getCascadeStatus } from '@/lib/net/api';

/**
 * A cascade save commits fast and reaches its hop nodes afterwards
 * (cascade.changed -> inbound-sync), so the toast that reports it has to resolve
 * itself rather than claim success the moment the request returns.
 *
 * The poll is deliberately detached from whatever started it: the form closes or
 * navigates away immediately and the toast should outlive it. It is bounded, so
 * a hop that never answers cannot poll forever: roughly 12 polls at 7s is a
 * minute and a half, well past a normal provisioning round, after which we name
 * whoever is still silent.
 */

const POLL_MS = 7000;
const MAX_POLLS = 12;

type Translate = (key: string, opts?: Record<string, unknown>) => string;

export function watchCascadeProvisioning(id: string, t: Translate): void {
  const toastId = `cascade-provisioning-${id}`;
  notifications.show({
    id: toastId,
    loading: true,
    autoClose: false,
    withCloseButton: false,
    title: t('cascades.saved'),
    message: t('cascades.provisioning'),
  });

  const settle = (color: string, message: string) =>
    notifications.update({
      id: toastId,
      loading: false,
      color,
      autoClose: 8000,
      title: t('cascades.saved'),
      message,
    });

  let polls = 0;
  let failures = 0;
  const poll = async () => {
    polls += 1;
    try {
      const st = await getCascadeStatus(id);
      failures = 0;
      if (st.done) {
        settle('green', t('cascades.provisioned'));
        return;
      }
      if (polls >= MAX_POLLS) {
        const waiting = st.hops.filter((h) => !h.applied).map((h) => h.name).join(', ');
        settle('yellow', t('cascades.provisionWaiting', { nodes: waiting }));
        return;
      }
    } catch {
      // Don't claim we're still waiting when we can't even ask. A blip or two is
      // normal; a persistent failure gets reported as unknown.
      failures += 1;
      if (failures >= 3) {
        settle('yellow', t('cascades.provisionUnknown'));
        return;
      }
    }
    window.setTimeout(poll, POLL_MS);
  };
  window.setTimeout(poll, POLL_MS);
}
