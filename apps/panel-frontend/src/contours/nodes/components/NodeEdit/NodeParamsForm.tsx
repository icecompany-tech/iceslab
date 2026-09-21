import { Caption } from '@/contours/nodes/components/NodeEdit/Caption';
import { Box, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { CARD, CYAN, HAIRLINE } from '@/contours/nodes/lib/colors';
import { COUNTRY_OPTIONS } from '@/lib/domain/countries';
import { FIELD } from '@/contours/nodes/lib/fieldStyles';
import { PolicyReach } from '@/contours/nodes/components/NodeEdit/PolicyReach';
import { PROTOCOL_OPTIONS } from '@/contours/nodes/lib/nodeProtocols';
import { ServerIcon } from '@/contours/nodes/components/NodeEdit/icons';
import { useTranslation } from 'react-i18next';
import { policyApplicability, type PolicyApplicability } from '@/contours/nodes/lib/policyReach';
import { FAINT, MIST, MONO, MOSS } from '@/contours/nodes/lib/colors';
import type { NodeEditor } from '@/contours/nodes/components/NodeEdit/useNodeEditForm';

/**
 * Name, address, region and protocol of the node, plus the save bar.
 */
export function NodeParamsForm({
  regionsQuery,
  form,
  node,
  nodePoliciesQuery,
  policyRefusal,
}: Pick<NodeEditor, 'regionsQuery' | 'form' | 'id' | 'node' | 'nodePoliciesQuery' | 'policyRefusal'>) {
  const { t } = useTranslation();
  const applicability = policyApplicability(node?.cores?.cores);

  return (
              <Stack
                gap={16}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ServerIcon size={15} color={CYAN} />
                  <Caption>{t('nodeEdit.paramsTitle')}</Caption>
                </Box>

                <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
                  <TextInput
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodes.form.name')}
                    description={t('nodes.form.nameDesc')}
                    required
                    {...form.getInputProps('name')}
                  />
                  <Select
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodes.form.protocol')}
                    description={t('nodeEdit.protocolDesc')}
                    data={PROTOCOL_OPTIONS}
                    allowDeselect={false}
                    {...form.getInputProps('protocol')}
                  />
                </Box>

                <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
                  <TextInput
                    {...FIELD}
                    style={{ flex: 2, minWidth: 0 }}
                    label={t('nodes.form.address')}
                    description={t('nodeEdit.addressDesc')}
                    required
                    {...form.getInputProps('host')}
                  />
                  <NumberInput
                    {...FIELD}
                    style={{ width: 130, flexShrink: 0 }}
                    label={t('nodes.form.port')}
                    description={t('nodeEdit.portDesc')}
                    min={1}
                    max={65535}
                    allowDecimal={false}
                    allowNegative={false}
                    hideControls
                    {...form.getInputProps('port')}
                  />
                </Box>

                <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
                  <Select
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodes.form.country')}
                    description={t('nodes.form.countryDesc')}
                    placeholder={t('nodeCreate.countryPlaceholder')}
                    data={COUNTRY_OPTIONS}
                    searchable
                    clearable
                    nothingFoundMessage={t('common.nothingFound')}
                    {...form.getInputProps('countryCode')}
                  />
                  <Select
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodeEdit.region')}
                    description={t('nodeEdit.regionDesc')}
                    placeholder={t('nodeEdit.noRegion')}
                    data={(regionsQuery.data?.regions ?? []).map((r) => ({
                      value: r.id,
                      label: `${r.code} · ${r.name}`,
                    }))}
                    clearable
                    {...form.getInputProps('regionId')}
                  />
                  <NumberInput
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodeEdit.multiplier')}
                    description={t('nodeEdit.multiplierDesc')}
                    min={0.1}
                    max={10}
                    step={0.1}
                    decimalScale={1}
                    fixedDecimalScale
                    allowNegative={false}
                    {...form.getInputProps('consumptionMultiplier')}
                  />
                  <NumberInput
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodeEdit.maxUsers')}
                    description={t('nodeEdit.maxUsersDesc')}
                    min={0}
                    allowDecimal={false}
                    allowNegative={false}
                    {...form.getInputProps('maxUsers')}
                  />
                </Box>

                {/* Э3 layer B. One policy can sit on many nodes, so the picker
                    names the policy and how many machines already carry it,
                    and choosing "none" is a real detach: the node's config is
                    rewritten without the rules rather than keeping the last
                    ones. A policy this machine cannot run is refused on save
                    with a sentence naming the node and the reason, shown
                    underneath rather than as a toast that scrolls away. */}
                {/* Достанет ли политика до этой машины, одним словом и до
                    селектора: читатель должен увидеть это ДО того, как выберет
                    правило, а не после сохранения.

                    В «не применима» поле приглушено, но НЕ отключено и
                    назначение не снимается: чинится это отдельной работой, и
                    после починки правило должно заработать само. Снять его
                    сейчас значит потерять выбор оператора молча. */}
                <PolicyApplicabilityLine state={applicability} />
                <Box style={{ opacity: applicability === 'not-applicable' ? 0.55 : 1 }}>
                  <Select
                    {...FIELD}
                    label={t('nodeEdit.policy')}
                    description={t('nodeEdit.policyDesc')}
                    placeholder={t('nodeEdit.policyNone')}
                    clearable
                    data={(nodePoliciesQuery.data?.policies ?? []).map((p) => ({
                      value: p.id,
                      label: p.nodeCount
                        ? `${p.name} · ${t('routes.nodeOnNodes', { count: p.nodeCount })}`
                        : p.name,
                    }))}
                    value={form.values.policyId || null}
                    onChange={(v) => form.setFieldValue('policyId', v ?? '')}
                  />
                </Box>
                {/* Подробности охвата только когда политика ВООБЩЕ применяется.
                    В двух других состояниях строка выше уже всё сказала, и
                    PolicyReach повторил бы её своими словами: «не применима»
                    он показывает как красную плашку «политика здесь не
                    работает», а «панель не знает» как серую строку про те же
                    ядра. Два сообщения об одном читаются как два разных факта.

                    Здесь он остаётся тем, ради чего написан: политика
                    применяется, но достаёт не всех, потому что одно ядро из
                    двух её не рисует. */}
                {applicability === 'applies' && (
                  <PolicyReach
                    cores={node?.cores?.cores}
                    hasPolicy={Boolean(form.values.policyId)}
                  />
                )}
                {/* Пояснение только там, где оно меняет чтение: «применяется»
                    и «панель не знает» говорят сами за себя, а «не применима»
                    обязана сказать, почему и что будет дальше. */}
                {applicability === 'not-applicable' && (
                  <Text style={{ fontSize: 12, lineHeight: '17px', color: MIST }}>
                    {t('nodeEdit.policyApplicabilityWhy')}
                  </Text>
                )}
                {policyRefusal && (
                  <Box
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      backgroundColor: '#E07A5F14',
                      border: '1px solid #E07A5F40',
                    }}
                  >
                    <Text style={{ fontSize: 12, lineHeight: '17px', color: '#E07A5F' }}>
                      {policyRefusal}
                    </Text>
                  </Box>
                )}
              </Stack>
  );
}

/**
 * Одна строка над селектором: достанет ли политика до этой ноды.
 *
 * Слова выбраны нарочно. «Не применима на этой ноде», а не «не поддерживается»:
 * нода не сломана, у неё просто нет ядра, которое рисует правила, и это разные
 * вещи на экране. «Панель не знает» стоит отдельно от «не применима», потому
 * что отсутствие ответа это не ответ «нет».
 */
function PolicyApplicabilityLine({ state }: { state: PolicyApplicability }) {
  const { t } = useTranslation();
  const tone = state === 'applies' ? MOSS : state === 'not-applicable' ? MIST : FAINT;

  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: tone,
        }}
      >
        {t(`nodeEdit.policyApplicability.${state}`)}
      </Text>
    </Box>
  );
}
