import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listCascades,
  updateCascade,
  deleteCascade,
  listNodes,
  apiErrorMessage,
  type Cascade,
} from '@/lib/net/api';
import { CascadesView, useCascadeRows, type CascadeLayout } from '@/contours/nodes/components/CascadesView';

/**
 * The "Cascades" sub-view of the Nodes page. A cascade is a chain of nodes, so
 * each hop is drawn as a real node card (flag / status / role / today's
 * traffic), connected entry -> ... -> exit by arrows labelled with the link
 * protocol. Self-contained: pulls its own cascades + node list + overview
 * metrics (react-query dedupes the shared keys with NodesPage).
 *
 * Building and editing a cascade both live on their own pages, so what is left
 * here is the list plus the two actions that need no form: the enabled switch
 * and delete.
 */
export function CascadesPanel({ layout = 'cards' }: { layout?: CascadeLayout }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const cascadesQuery = useQuery({ queryKey: ['cascades'], queryFn: listCascades });
  const nodesQuery = useQuery({ queryKey: ['nodes', 'all'], queryFn: () => listNodes({ limit: 100 }) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['cascades'] });
  const onError = (err: unknown) => {
    // Cascade writes commit fast and provision nodes asynchronously, so a slow
    // or timed-out response can fire onError even though the change landed.
    // Refetch so the list reflects reality instead of a stale view.
    invalidate();
    notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) });
  };

  const deleteMutation = useMutation({
    mutationFn: deleteCascade,
    onSuccess: () => {
      invalidate();
      notifications.show({ color: 'green', message: t('cascades.deleted') });
    },
    onError,
  });

  const enableMutation = useMutation({
    mutationFn: (c: Cascade) => updateCascade(c.id, { enabled: !c.enabled }),
    onSuccess: invalidate,
    onError,
  });

  const rows = useCascadeRows(cascadesQuery.data?.cascades ?? [], nodesQuery.data?.nodes ?? []);

  return (
    <Stack gap="md">
      {/* The list itself: one component, two densities. The explainer strip
          that used to sit here is gone: the cards say what a cascade is by
          drawing one, and the action lives in the page bar. */}
      <CascadesView
        rows={rows}
        layout={layout}
        onEdit={(c) => navigate(`/nodes/cascades/${c.id}`)}
        onDelete={(c) => deleteMutation.mutate(c.id)}
        onToggleEnabled={(c) => enableMutation.mutate(c)}
      />
    </Stack>
  );
}
