import { countryFlag } from '@/lib/domain/countries';
import { NodeNotFound } from '@/contours/nodes/components/NodeEdit/NodeNotFound';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { ChainIcon, TrashIcon } from '@/contours/nodes/components/NodeEdit/icons';
import { DotChip } from '@/contours/nodes/components/NodeEdit/DotChip';
import { EgressCard } from '@/contours/nodes/components/NodeEdit/EgressCard';
import { HostsPanel } from '@/contours/nodes/components/NodeEdit/HostsPanel';
import { NodeParamsForm } from '@/contours/nodes/components/NodeEdit/NodeParamsForm';
import { PlainButton } from '@/contours/nodes/components/NodeEdit/PlainButton';
import { ResolvedRoutes } from '@/contours/nodes/components/NodeEdit/ResolvedRoutes';
import { Sep } from '@/contours/nodes/components/NodeEdit/Separators';
import { SyncStatusStrip } from '@/contours/nodes/components/NodeEdit/SyncStatusStrip';
import { SystemPanel } from '@/contours/nodes/components/NodeEdit/SystemPanel';
import { TabButton } from '@/contours/nodes/components/NodeEdit/TabButton';
import { useNodeEditForm } from '@/contours/nodes/components/NodeEdit/useNodeEditForm';
import { AMBER, CARD, DISPLAY, HAIRLINE, MIST, MONO, MOSS, RED, SNOW, VIOLET, WELL } from '@/contours/nodes/lib/colors';
import { ServerIcon } from '@/contours/nodes/components/NodeCreate/icons';
import { useTranslation } from 'react-i18next';
import { modals } from '@mantine/modals';
import {
  deleteNode,
} from '@/lib/domain/nodes';

/**
 * A registered node, as a page with tabs. Parameters is what the panel stores
 * about the machine; Routes is what leaves through it. The two never share a
 * screen because they answer different questions and are saved separately.
 */

export function NodeEditPage() {
  const { t } = useTranslation();
  const {
    tab,
    setTab,
    id,
    navigate,
    qc,
    nodesQuery,
    node,
    regionsQuery,
    hostsQuery,
    form,
    dashNode,
    metrics,
    cascade,
    isBalancerEntry,
    reachablePolicies,
    profileById,
    bindingById,
    saveMutation,
    warpMutation,
    exposureMutation,
    bootstrapMutation,
    statusTone,
    egress,
    nodePoliciesQuery,
    syncQuery,
    policyRefusal,
  } = useNodeEditForm();

  // The id in the URL may match nothing: show the fallback rather than an
  // editor bound to a node that is not there.
  if (!node) {
    return <NodeNotFound isLoading={nodesQuery.isLoading} onBack={() => navigate('/nodes')} />;
  }

  return (
    <Stack gap={20}>
      {/* Page bar */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 64,
          padding: '8px 8px 8px 14px',
          borderRadius: 10,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box style={{ display: 'flex', alignItems: 'center', gap: 11, paddingRight: 14, flexShrink: 0 }}>
          <Box
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: `${MOSS}1A`,
              border: `1px solid ${MOSS}33`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ServerIcon size={18} color={MOSS} />
          </Box>
          {node.countryCode && (
            <Text style={{ fontSize: 15, lineHeight: '15px' }}>{countryFlag(node.countryCode)}</Text>
          )}
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {node.name}
          </Text>
        </Box>
        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, paddingLeft: 14 }}>
          <DotChip color={statusTone}>{node.status}</DotChip>
          <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>{node.address}</Text>
          {cascade && (
            <>
              <Sep />
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 20,
                  paddingInline: 8,
                  borderRadius: 5,
                  backgroundColor: `${VIOLET}1A`,
                  border: `1px solid ${VIOLET}33`,
                }}
              >
                <ChainIcon size={13} color={VIOLET} />
                <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: VIOLET }}>
                  {cascade.cascade.name} · {t(`nodeEdit.role.${cascade.role}`)}
                </Text>
              </Box>
            </>
          )}
          {/* Unsaved work is stated in the bar, not implied by an enabled
              button: the Save button looks the same either way. */}
          {form.isDirty() && (
            <>
              <Sep />
              <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: AMBER }} />
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    lineHeight: '12px',
                    textTransform: 'uppercase',
                    color: AMBER,
                  }}
                >
                  {t('nodeEdit.unsaved')}
                </Text>
              </Box>
            </>
          )}
        </Box>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, flexShrink: 0 }}>
          <PlainButton icon="key" strong onClick={() => bootstrapMutation.mutate()}>
            {t('nodeEdit.reissue')}
          </PlainButton>
          <UnstyledButton
            type="button"
            onClick={() =>
              modals.openConfirmModal({
                title: t('nodes.deleteTitle', { name: node.name }),
                children: <Text size="sm">{t('nodes.deleteBody')}</Text>,
                labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
                confirmProps: { color: 'red' },
                onConfirm: async () => {
                  await deleteNode(node.id);
                  qc.invalidateQueries({ queryKey: ['nodes'] });
      qc.invalidateQueries({ queryKey: ['node', id] });
                  navigate('/nodes');
                },
              })
            }
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              backgroundColor: WELL,
              border: `1px solid ${HAIRLINE}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <TrashIcon size={15} color={RED} />
          </UnstyledButton>
          <Box style={{ width: 1, height: 24, backgroundColor: HAIRLINE, flexShrink: 0 }} />
          <PlainButton onClick={() => navigate('/nodes')}>{t('common.cancel')}</PlainButton>
          <PlainButton
            icon="tick"
            strong
            disabled={saveMutation.isPending}
            onClick={() => {
              if (!form.validate().hasErrors) saveMutation.mutate();
            }}
          >
            {t('common.save')}
          </PlainButton>
        </Box>
      </Box>

      {/* Tabs */}
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <TabButton active={tab === 'params'} onClick={() => setTab('params')} icon="server">
          {t('nodeEdit.tabParams')}
        </TabButton>
        <TabButton
          active={tab === 'routes'}
          onClick={() => setTab('routes')}
          icon="route"
          badge={cascade ? 1 : 0}
        >
          {t('nodeEdit.tabRoutes')}
        </TabButton>
      </Box>

      {/* Above the tabs' content, not inside one of them: an unapplied config
          is true of the node, not of the sheet the operator happens to have
          open, and it is the first thing worth knowing on this page. */}
      <SyncStatusStrip status={syncQuery.data} />

      {tab === 'params' && (
        <>
          <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
            <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0 }}>
              <NodeParamsForm
                regionsQuery={regionsQuery}
                form={form}
                id={id}
                nodePoliciesQuery={nodePoliciesQuery}
                policyRefusal={policyRefusal}
              />

              <EgressCard navigate={navigate} cascade={cascade} warpMutation={warpMutation} egress={egress} />
            </Box>

            <SystemPanel hostsQuery={hostsQuery} dashNode={dashNode} metrics={metrics} exposureMutation={exposureMutation} />
          </Box>

          <HostsPanel navigate={navigate} qc={qc} node={node} hostsQuery={hostsQuery} profileById={profileById} bindingById={bindingById} id={id} />
        </>
      )}

      {tab === 'routes' && (
        <ResolvedRoutes
          node={node}
          cascade={cascade}
          isBalancerEntry={isBalancerEntry}
          policies={reachablePolicies}
          egressLabel={egress === 'warp' ? t('nodeEdit.egressWarp') : t('nodeEdit.egressDirect')}
        />
      )}
    </Stack>
  );
}

/**
 * What the panel actually assembled for this node, read-only. The rules are
 * evaluated top to bottom by the core, so the list is printed in that order and
 * a rule that a rule above already swallowed is struck out instead of hidden:
 * the operator wrote it, and silently dropping it would look like a panel bug.
 */


