import { Caption } from '@/contours/nodes/components/NodeEdit/Caption';
import { Box, NumberInput, Select, Stack, TextInput } from '@mantine/core';
import { CARD, CYAN, HAIRLINE } from '@/contours/nodes/lib/colors';
import { COUNTRY_OPTIONS } from '@/lib/domain/countries';
import { FIELD } from '@/contours/nodes/lib/fieldStyles';
import { PROTOCOL_OPTIONS } from '@/contours/nodes/lib/nodeProtocols';
import { ServerIcon } from '@/contours/nodes/components/NodeEdit/icons';
import { useTranslation } from 'react-i18next';
import type { NodeEditor } from '@/contours/nodes/components/NodeEdit/useNodeEditForm';

/**
 * Name, address, region and protocol of the node, plus the save bar.
 */
export function NodeParamsForm({
  regionsQuery,
  form,
}: Pick<NodeEditor, 'regionsQuery' | 'form' | 'id'>) {
  const { t } = useTranslation();

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
              </Stack>
  );
}
