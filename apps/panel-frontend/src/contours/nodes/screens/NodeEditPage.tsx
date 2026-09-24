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
import { SyncRefusalStrip } from '@/ui/SyncRefusalStrip';
import { SyncStatusStrip } from '@/contours/nodes/components/NodeEdit/SyncStatusStrip';
import { SystemPanel } from '@/contours/nodes/components/NodeEdit/SystemPanel';
import { TabButton } from '@/contours/nodes/components/NodeEdit/TabButton';
import { useNodeEditForm } from '@/contours/nodes/components/NodeEdit/useNodeEditForm';
import { CoresPanel } from '@/contours/nodes/components/NodeEdit/CoresPanel';
import { AMBER, CARD, DISPLAY, HAIRLINE, MIST, MONO, MOSS, RED, SNOW, VIOLET, WELL } from '@/contours/nodes/lib/colors';
import { refusalOf } from '@/lib/domain/syncRefusal';
import { chainFacts } from '@/lib/domain/chainStatus';
import { ChainStatusLine } from '@/ui/ChainStatusLine';
import { ServerIcon } from '@/contours/nodes/components/NodeCreate/icons';
import { useEffect } from 'react';
import { intendedEnginesWords } from '@/lib/domain/engines';
import { useTranslation } from 'react-i18next';
import { modals } from '@mantine/modals';
import {
  deleteNode,
} from '@/lib/domain/nodes';
import { NodeDeleteCascades } from '@/contours/nodes/components/NodeDelete';
import { showNodeDeleteFailed } from '@/contours/nodes/components/nodeDeleteToast';
import { nodeDeleteFacts } from '@/contours/nodes/lib/nodeDelete';

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
    awgKnown,
    coreRefusal,
    enginesKnown,
    enginesRefusal,
    setEnginesRefusal,
  } = useNodeEditForm();

  // `#cores`: the deploy window and the host form link here for a core the
  // node lacks. Scrolled once the node has loaded, since the section is not in
  // the page before that, and a beat later: the cards above it fill from their
  // own queries and would push it back down.
  const loaded = node !== undefined;
  useEffect(() => {
    if (!loaded || window.location.hash !== '#cores') return;
    const timer = setTimeout(() => {
      document.getElementById('cores')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 600);
    return () => clearTimeout(timer);
  }, [loaded]);

  // The id in the URL may match nothing: show the fallback rather than an
  // editor bound to a node that is not there.
  if (!node) {
    return <NodeNotFound isLoading={nodesQuery.isLoading} onBack={() => navigate('/nodes')} />;
  }

  // После guard, а не до него: до него `node` это `Node | undefined`, и
  // считать отказ там значит тащить неопределённость через всю страницу.
  const refusal = refusalOf(node);
  const chain = chainFacts(node);

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
          {/* Ядра, на которые нода настроена (intendedEngines), основное
              первым. Намерение, не отчёт: что стоит, говорит секция «Ядра». */}
          {node.intendedEngines && node.intendedEngines.length > 0 && (
            <Text
              title={t('nodeEdit.intendedEnginesHint')}
              style={{ fontFamily: MONO, fontSize: 12, lineHeight: '16px', color: MIST, whiteSpace: 'nowrap' }}
            >
              {intendedEnginesWords(node.intendedEngines)}
            </Text>
          )}
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
            onClick={() => {
              // Включённый каскад держит ноду: кнопка недоступна до щелчка, а
              // отказ, если всё же пришёл, говорит словами (E28). Раньше отказ
              // здесь терялся вовсе: onConfirm ждал удаления без catch.
              const cascades = nodeDeleteFacts(node);
              const blocked = (cascades?.blocked.length ?? 0) > 0;
              modals.openConfirmModal({
                title: t('nodes.deleteTitle', { name: node.name }),
                children: (
                  <Stack gap="sm">
                    <NodeDeleteCascades facts={cascades} />
                    <Text size="sm">{t('nodes.deleteBody')}</Text>
                  </Stack>
                ),
                labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
                confirmProps: {
                  color: 'red',
                  disabled: blocked,
                  title: blocked ? t('nodeConfirm.deleteBlockedHint') : undefined,
                },
                onConfirm: async () => {
                  try {
                    await deleteNode(node.id);
                  } catch (err) {
                    showNodeDeleteFailed(err, t);
                    return;
                  }
                  qc.invalidateQueries({ queryKey: ['nodes'] });
                  qc.invalidateQueries({ queryKey: ['node', id] });
                  navigate('/nodes');
                },
              });
            }}
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
          open, and it is the first thing worth knowing on this page.

          Отказ вытесняет «ещё не применено», а не встаёт рядом с ним: это одно
          и то же событие, только с причиной, и две полосы подряд про один пуш
          читаются как две разные беды. */}
      {refusal ? <SyncRefusalStrip refusal={refusal} /> : <SyncStatusStrip status={syncQuery.data} />}

      {/* Рядом с отказом ядра, но отдельной сущностью: конфиг и процесс цепи
          ломаются независимо, и объединять их значит прятать одно за другим. */}
      {chain && <ChainStatusLine facts={chain} />}

      {tab === 'params' && (
        <>
          <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
            <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0 }}>
              <NodeParamsForm
                regionsQuery={regionsQuery}
                form={form}
                id={id}
                node={node}
                nodePoliciesQuery={nodePoliciesQuery}
                policyRefusal={policyRefusal}
                awgKnown={awgKnown}
                enginesKnown={enginesKnown}
                enginesRefusal={enginesRefusal}
                setEnginesRefusal={setEnginesRefusal}
              />

              <EgressCard navigate={navigate} cascade={cascade} warpMutation={warpMutation} egress={egress} />

              {/* Состав ядер приходит от самой ноды, поэтому секция стоит
                  рядом с параметрами, а не в системной панели справа: это
                  свойство ноды, а не метрика хоста. */}
              <Box id="cores" style={{ scrollMarginTop: 16 }}>
                <CoresPanel
                  node={node}
                  // Выбор версии живёт в форме ноды и уходит её «Сохранить».
                  // Сервер старше поля (ключа нет в ответе): выбора нет вовсе.
                  intent={node.coreVersions !== undefined ? form.values.coreVersions : undefined}
                  onIntent={(next) => form.setFieldValue('coreVersions', next)}
                  refusal={coreRefusal}
                />
              </Box>
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


