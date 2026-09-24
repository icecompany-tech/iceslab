import { AMBER, CARD, CYAN, DISPLAY, FAINT, HAIRLINE, MOSS, SNOW } from '@/contours/nodes/lib/colors';
import { Box, NumberInput, Select, Stack, TagsInput, Text, TextInput } from '@mantine/core';
import { COUNTRY_OPTIONS } from '@/lib/domain/countries';
import { FIELD } from '@/contours/nodes/lib/fieldStyles';
import { FieldLabel } from '@/contours/nodes/components/NodeCreate/FieldLabel';
import { NODE_PROTOCOL_GROUPED, SINGBOX_ENGINE_CAPABLE } from '@/contours/nodes/lib/nodeProtocols';
import { SectionCard } from '@/contours/nodes/components/NodeCreate/SectionCard';
import { ServerIcon, ShieldPinIcon } from '@/contours/nodes/components/NodeCreate/icons';
import { ToggleRow } from '@/contours/nodes/components/NodeCreate/ToggleRow';
import { useTranslation } from 'react-i18next';
import type { useNodeCreateForm } from '@/contours/nodes/components/NodeCreate/useNodeCreateForm';
import { awgSelectorShown } from '@/lib/domain/awg';
import { AwgProtocolSelect } from '@/contours/nodes/components/AwgProtocolSelect';
import { WizardCoreVersions } from '@/contours/nodes/components/NodeCreate/WizardCoreVersions';
import { EngineChips } from '@/contours/nodes/components/EngineChips';

type Wizard = ReturnType<typeof useNodeCreateForm>;

/**
 * Step one: what the node is and how it is reached. Name, address, region,
 * protocol and the hardening switches.
 */
export function StepParams({
  form,
  awgKnown,
  coreVersionsKnown,
  coreRefusal,
  enginesKnown,
  engines,
  enginesRefusal,
  setEnginesRefusal,
}: Pick<
  Wizard,
  | 'form'
  | 'awgKnown'
  | 'coreVersionsKnown'
  | 'coreRefusal'
  | 'enginesKnown'
  | 'engines'
  | 'enginesRefusal'
  | 'setEnginesRefusal'
>) {
  const { t } = useTranslation();

  return (
        <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0 }}>
            <SectionCard title={t('nodeCreate.paramsTitle')} icon={<ServerIcon size={15} color={CYAN} />}>
              <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
                <TextInput
                  {...FIELD}
                  style={{ flex: 1, minWidth: 0 }}
                  label={t('nodes.form.name')}
                  description={t('nodes.form.nameDesc')}
                  placeholder="eu-1"
                  required
                  {...form.getInputProps('name')}
                />
                {/* Сервер старше intendedEngines: прежний селект протокола. */}
                {!enginesKnown && (
                  <Select
                    {...FIELD}
                    style={{ flex: 1, minWidth: 0 }}
                    label={t('nodes.form.protocol')}
                    description={t('nodes.form.protocolDesc')}
                    data={NODE_PROTOCOL_GROUPED}
                    allowDeselect={false}
                    {...form.getInputProps('protocol')}
                  />
                )}
              </Box>

              {/* Нода живёт с несколькими ядрами (владелец, 24.09): чип на
                  ядро, первое отмеченное основное, протокол под ним. */}
              {enginesKnown && (
                <EngineChips
                  engines={form.values.engines}
                  protocol={form.values.protocol}
                  error={enginesRefusal}
                  onChange={({ engines: next, protocol }) => {
                    form.setFieldValue('engines', next);
                    form.setFieldValue('protocol', protocol);
                    setEnginesRefusal(null);
                  }}
                />
              )}

              {/* Engine choice is a claim about the machine, not a field: it
                  changes the install command, so it reads as its own row.
                  Only for a server older than intendedEngines: there sing-box
                  is a chip. */}
              {!enginesKnown && SINGBOX_ENGINE_CAPABLE.includes(form.values.protocol) && (
                <ToggleRow
                  checked={form.values.singboxEngine}
                  onChange={(v) => form.setFieldValue('singboxEngine', v)}
                  title={t('nodes.form.singboxEngine')}
                  hint={t('nodes.form.singboxEngineDesc')}
                  titleSize={13}
                />
              )}

              {/* Версии ядер на установку, по всем выбранным ядрам. Сервер
                  старше поля (ни у одной ноды парка ключа нет): выбора нет,
                  пины уходят сами. */}
              {coreVersionsKnown && (
                <WizardCoreVersions
                  engines={engines}
                  value={form.values.coreVersions}
                  onChange={(next) => form.setFieldValue('coreVersions', next)}
                  refusal={coreRefusal}
                />
              )}

              {/* Поколение AmneziaWG. У новой ноды ядер ещё нет, поэтому
                  решает выбор: AmneziaWG среди ядер ноды. */}
              {awgSelectorShown(awgKnown, engines.includes('amneziawg') ? 'amneziawg' : form.values.protocol, null) && (
                <AwgProtocolSelect
                  value={form.values.awgProtocol}
                  onChange={(g) => form.setFieldValue('awgProtocol', g)}
                />
              )}

              <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
                <TextInput
                  {...FIELD}
                  style={{ flex: 2, minWidth: 0 }}
                  label={t('nodes.form.address')}
                  description={t('nodes.form.addressDesc')}
                  placeholder="n1.example.com"
                  required
                  {...form.getInputProps('host')}
                />
                <NumberInput
                  {...FIELD}
                  style={{ width: 130, flexShrink: 0 }}
                  label={t('nodes.form.port')}
                  description={t('nodes.form.portDesc')}
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
                <NumberInput
                  {...FIELD}
                  style={{ flex: 1, minWidth: 0 }}
                  label={t('nodes.form.multiplier')}
                  description={t('nodes.form.multiplierDesc')}
                  min={0.1}
                  max={10}
                  step={0.1}
                  decimalScale={1}
                  fixedDecimalScale
                  allowNegative={false}
                  {...form.getInputProps('consumptionMultiplier')}
                />
              </Box>

              <TextInput
                {...FIELD}
                label={t('nodes.form.domain')}
                description={t('nodes.form.domainDesc')}
                placeholder="des-01.example.com"
                {...form.getInputProps('domain')}
              />
            </SectionCard>
          </Box>

          {/* Hardening rides its own column: every switch here changes what the
              installer does to the box, not what the panel stores. */}
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 520, flexShrink: 0 }}>
            <Box
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                padding: 20,
                borderRadius: 10,
                backgroundColor: CARD,
                border: `1px solid ${HAIRLINE}`,
              }}
            >
              <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Box
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    backgroundColor: `${MOSS}1A`,
                    border: `1px solid ${MOSS}33`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <ShieldPinIcon size={14} color={MOSS} />
                </Box>
                <Stack gap={2}>
                  <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 600, lineHeight: '17px', color: SNOW }}>
                    {t('nodes.form.hardeningSection')}
                  </Text>
                  <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
                    {t('nodes.form.hardeningSectionDesc')}
                  </Text>
                </Stack>
              </Box>

              <ToggleRow
                checked={form.values.hardenUfw}
                onChange={(v) => form.setFieldValue('hardenUfw', v)}
                title={t('nodes.form.hardeningUfw')}
                hint={t('nodes.form.hardeningUfwDesc')}
              />
              <ToggleRow
                checked={form.values.hardenFail2ban}
                onChange={(v) => form.setFieldValue('hardenFail2ban', v)}
                title={t('nodes.form.hardeningFail2ban')}
                hint={t('nodes.form.hardeningFail2banDesc')}
              />
              <ToggleRow
                checked={form.values.hardenRealisticFallback}
                onChange={(v) => form.setFieldValue('hardenRealisticFallback', v)}
                title={t('nodes.form.hardeningRealisticFallback')}
                hint={t('nodes.form.hardeningRealisticFallbackDesc')}
              />

              <Stack gap={6}>
                <FieldLabel>{t('nodes.form.hardeningSshAllowlist')}</FieldLabel>
                <TagsInput
                  placeholder="10.0.0.0/8"
                  clearable
                  {...form.getInputProps('hardenSshAllowlist')}
                />
                {/* Amber, not grey: an empty allowlist is the state that bites. */}
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: AMBER }}>
                  {t('nodes.form.hardeningSshAllowlistDesc')}
                </Text>
              </Stack>
            </Box>
          </Box>
        </Box>
  );
}
