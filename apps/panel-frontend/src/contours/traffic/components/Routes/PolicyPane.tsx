import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Stack } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { listCascades } from '@/lib/domain/cascades';
import { listNodePolicies, type NodePolicy } from '@/lib/domain/nodePolicies';
import { ListEmpty, ListHead, ListRow } from '@/contours/traffic/components/Routes/RuleList';
import { NodePolicyEditor } from '@/contours/traffic/components/NodePolicy/NodePolicyEditor';
import type { DirectionOption } from '@/contours/traffic/components/NodePolicy/RuleRow';

/**
 * Layer B: the policies a node runs, and the one being edited.
 *
 * A policy is not owned by a node. It is written once and attached to as many
 * nodes as the operator likes, so the list counts machines rather than naming
 * one, and the editor says the same thing in its header.
 */
export function PolicyPane({
  draft,
  draftKey,
  onDraftDone,
}: {
  draft: NodePolicy | null;
  draftKey: number;
  onDraftDone: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);

  const policiesQuery = useQuery({ queryKey: ['node-policies'], queryFn: listNodePolicies });
  // A cascade rule has to name the way out it uses, and the ways out live on
  // the cascades. Read here rather than in the row so one request serves the
  // whole list instead of one per open menu.
  const cascadesQuery = useQuery({ queryKey: ['cascades'], queryFn: listCascades });

  const policies = policiesQuery.data?.policies ?? [];

  const directions: DirectionOption[] = useMemo(
    () =>
      (cascadesQuery.data?.cascades ?? []).flatMap((c) =>
        c.directions.map((d) => ({
          id: d.id,
          // Same label the API derives, plus the cascade it belongs to: two
          // cascades can both have a DE exit and the id is no help to a reader.
          label: `${c.name} · ${d.countryCode ? d.countryCode.toUpperCase() : t('routes.nodeDirectionTag', { tag: d.tag })}`,
        })),
      ),
    [cascadesQuery.data, t],
  );

  const policy = draft ?? policies.find((p) => p.id === selected) ?? policies[0] ?? null;

  return (
    <Box className="routes-panes">
      <Stack gap={0} className="routes-list">
        <ListHead label={t('routes.nodePoliciesTitle')} count={policies.length} />

        {draft && (
          <ListRow
            selected
            title={draft.name || t('routes.newPolicy')}
            sub={t('routes.newPolicySub')}
            onClick={() => undefined}
          />
        )}

        {policies.map((p) => (
          <ListRow
            key={p.id}
            selected={!draft && policy?.id === p.id}
            title={p.name}
            sub={[
              t('routes.ruleCount', { count: p.rules.length }),
              p.nodeCount
                ? t('routes.nodeOnNodes', { count: p.nodeCount })
                : t('routes.nodeOnNoNodes'),
            ].join(' · ')}
            onClick={() => {
              onDraftDone();
              setSelected(p.id);
            }}
          />
        ))}

        {policies.length === 0 && !policiesQuery.isLoading && !draft && (
          <ListEmpty>{t('routes.nodeNoPolicies')}</ListEmpty>
        )}
      </Stack>

      {policy && (
        <NodePolicyEditor
          key={draft ? `draft-${draftKey}` : policy.id}
          policy={policy}
          directions={directions}
          isDraft={!!draft}
          onSaved={(saved) => {
            onDraftDone();
            setSelected(saved.id);
          }}
          onDeleted={() => {
            onDraftDone();
            setSelected(null);
          }}
        />
      )}
    </Box>
  );
}
