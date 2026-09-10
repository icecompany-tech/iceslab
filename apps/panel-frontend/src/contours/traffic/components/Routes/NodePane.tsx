import type { RoutePolicy } from '@/lib/domain/routePolicies';
import type { Squad } from '@/lib/domain/squads';
import { Box, Stack, Text } from '@mantine/core';
import { DISPLAY, MIST } from '@/contours/traffic/lib/colors';
import { DetailHead } from '@/contours/traffic/components/Routes/DetailHead';
import { ListEmpty, ListHead, ListRow } from '@/contours/traffic/components/Routes/RuleList';
import { LockedRow } from '@/contours/traffic/components/Routes/LockedRow';
import { RoutePolicyEditor } from '@/contours/traffic/components/RoutePolicyEditor';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
export function NodePane({
  policies,
  squads,
  loading,
  draft,
  draftKey,
  onDraftDone,
}: {
  policies: RoutePolicy[];
  squads: Squad[];
  loading: boolean;
  draft: RoutePolicy | null;
  draftKey: number;
  onDraftDone: () => void;
}) {
  const { t } = useTranslation();
  // `null` is the plain profile: ordinal 0, implicit, never a row in the table.
  const [selected, setSelected] = useState<string | null>(null);
  const policy = draft ?? policies.find((p) => p.id === selected) ?? null;

  return (
    <Box className="routes-panes">
      <Stack gap={0} className="routes-list">
        <ListHead label={t('routes.policiesTitle')} count={policies.length} />

        {draft && (
          <ListRow
            selected
            title={draft.name || t('routes.newPolicy')}
            sub={t('routes.newPolicySub')}
            onClick={() => undefined}
          />
        )}

        <ListRow
          selected={!draft && selected === null}
          title={t('routes.plainName')}
          sub={t('routes.plainSub')}
          badge={t('routes.builtIn')}
          onClick={() => {
            onDraftDone();
            setSelected(null);
          }}
        />
        {policies.map((p) => {
          const granted = squads.filter((s) => s.policyIds.includes(p.id));
          const total = p.rules?.length ?? p.directDomains.length + p.blockDomains.length;
          return (
            <ListRow
              key={p.id}
              selected={!draft && selected === p.id}
              title={p.name}
              sub={[
                t('routes.ruleCount', { count: total }),
                granted.length > 0
                  ? t('routes.squadCount', { count: granted.length })
                  : t('routes.grantedToNobody'),
              ].join(' · ')}
              onClick={() => {
                onDraftDone();
                setSelected(p.id);
              }}
            />
          );
        })}
        {policies.length === 0 && !loading && <ListEmpty>{t('routes.noPolicies')}</ListEmpty>}
      </Stack>

      {policy === null ? (
        <Stack gap={0} className="routes-detail">
          <DetailHead title={t('routes.plainName')} chip={t('routes.builtIn')} note={t('routes.firstMatchWins')} />
          <Box style={{ padding: '20px 22px' }}>
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: MIST }}>
              {t('routes.plainBody')}
            </Text>
          </Box>
          <LockedRow
            label={t('routes.everythingElse')}
            value={t('routes.nodeDoor')}
            note={t('routes.nodeDoorNote')}
          />
        </Stack>
      ) : (
        <RoutePolicyEditor
          key={draft ? `draft-${draftKey}` : policy.id}
          policy={policy}
          squads={squads}
          onCreated={() => {
            onDraftDone();
            setSelected(null);
          }}
        />
      )}
    </Box>
  );
}

/* ───── On the device ───────────────────────────────────────────────────── */
