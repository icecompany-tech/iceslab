import { notifications } from '@mantine/notifications';
import { apiErrorMessage } from '@/lib/net/client';
import { nodeDeleteRefusal } from '@/contours/nodes/lib/nodeDelete';
import { NodeInCascadeMessage } from '@/contours/nodes/components/NodeDelete';

/**
 * Тост отказа удаления ноды (E28). 409 NODE_IN_USE_BY_CASCADE говорит, какой
 * каскад держит ноду и что сделать, код в подписи; любой другой отказ словами
 * сервера (apiErrorMessage), как на остальных экранах. Раньше здесь стояла
 * строка axios «Request failed with status code 409».
 */
export function showNodeDeleteFailed(err: unknown, t: (key: string, opts?: Record<string, unknown>) => string) {
  const refusal = nodeDeleteRefusal(err);
  if (!refusal) {
    notifications.show({ color: 'red', title: t('nodeConfirm.deleteFailed'), message: apiErrorMessage(err) });
    return;
  }
  const names = refusal.cascades.map((n) => `«${n}»`).join(', ');
  notifications.show({
    color: 'red',
    autoClose: 12000,
    title: refusal.cascades.length
      ? t('nodeConfirm.inCascadeTitle', { count: refusal.cascades.length, names })
      : t('nodeConfirm.inCascadeTitleUnnamed'),
    message: <NodeInCascadeMessage />,
  });
}
