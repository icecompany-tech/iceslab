import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Stepper,
  Switch,
  TagsInput,
  Text,
  TextInput,
  ThemeIcon,
} from '@mantine/core';
import { useForm, type UseFormReturnType } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { IconBolt, IconRocket, IconServer2, IconShieldLock } from '@tabler/icons-react';
import {
  listProfiles,
  type CreateNodeInput,
  type Node,
  type NodeHardening,
  type NodeProtocol,
  type Profile,
  type UpdateNodeInput,
} from '../lib/api';
import { COUNTRY_OPTIONS } from '../lib/countries';

const PROTOCOL_OPTIONS: { value: NodeProtocol; label: string }[] = [
  { value: 'xray', label: 'Xray' },
  { value: 'hysteria', label: 'Hysteria 2' },
  { value: 'amneziawg', label: 'AmneziaWG' },
  { value: 'naive', label: 'NaiveProxy' },
  { value: 'shadowsocks', label: 'Shadowsocks 2022' },
  { value: 'mtproto', label: 'MTProto (Telegram-only)' },
  { value: 'mieru', label: 'Mieru (stealth proxy)' },
];

// Node protocol dropdown = real protocols + a disabled sing-box teaser after
// xray (roadmap signal; not installable yet). Separate from the typed
// PROTOCOL_OPTIONS so the sentinel value never enters NodeProtocol form state.
const NODE_PROTOCOL_SELECT_DATA = [
  PROTOCOL_OPTIONS[0], // xray
  { value: '__singbox_soon', label: 'sing-box (soon)', disabled: true },
  ...PROTOCOL_OPTIONS.slice(1),
];

// Default mTLS port the node-agent listens on. Hard-coded in
// install-iceslab-node.sh; admins can override per-node via the Port field.
// Wave-13 (2026-05-21) bumped from 8443 to 1337: 8443 is the canonical
// HTTPS-alt scanned by every bot the moment 443 closes, 1337 is rare-enough
// that random probes pass us by AND frees 8443 for user-protocol bindings.
// Existing nodes installed before the bump stay on 8443 — their address is
// pinned in DB. Only fresh installs default to 1337.
const DEFAULT_NODE_PORT = 1337;

interface FormValues {
  name: string;
  // Address is split in the UI into a host field and a port field
  // (Remnawave-style - admin sees the port that will actually be used,
  // can edit if their install-node ran with a non-default port). At
  // submit time we recombine into the `host:port` string the backend
  // already accepts.
  host: string;
  port: number | '';
  protocol: NodeProtocol;
  countryCode: string;
  consumptionMultiplier: number | '';
  // B3/G - public FQDN of THIS node (A-record to its IP). Used as the REALITY
  // serverName for self-steal profiles deployed here. Empty = no self-steal/ACME.
  domain: string;
  // G (Zashchita) - probe-resistance toggles. Flattened into form state;
  // recombined into a NodeHardening blob (or null) via buildHardening on submit.
  hardenUfw: boolean;
  hardenFail2ban: boolean;
  hardenRealisticFallback: boolean;
  hardenSshAllowlist: string[];
}

/**
 * G - collapse the flat hardening form fields into the NodeHardening blob the
 * backend persists. Returns null when nothing is enabled so the common node
 * keeps hardening = NULL and the install command stays byte-identical.
 */
function buildHardening(v: {
  hardenUfw: boolean;
  hardenFail2ban: boolean;
  hardenRealisticFallback: boolean;
  hardenSshAllowlist: string[];
}): NodeHardening | null {
  const allow = v.hardenSshAllowlist.map((s) => s.trim()).filter(Boolean);
  const h: NodeHardening = {};
  if (v.hardenUfw) h.ufwLockdown = true;
  if (v.hardenFail2ban) h.fail2ban = true;
  if (v.hardenRealisticFallback) h.realisticFallback = true;
  if (allow.length > 0) h.sshAllowlist = allow;
  return Object.keys(h).length > 0 ? h : null;
}

/** Split a stored `address` into host + port. Empty port → DEFAULT_NODE_PORT. */
function splitAddress(address: string): { host: string; port: number } {
  const idx = address.indexOf(':');
  if (idx === -1) {
    return { host: address, port: DEFAULT_NODE_PORT };
  }
  const host = address.slice(0, idx);
  const portRaw = address.slice(idx + 1);
  const port = Number.parseInt(portRaw, 10);
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_NODE_PORT,
  };
}

function defaults(node: Node | null): FormValues {
  const { host, port } = splitAddress(node?.address ?? '');
  return {
    name: node?.name ?? '',
    host,
    port,
    protocol: node?.protocol ?? 'xray',
    countryCode: node?.countryCode ?? '',
    consumptionMultiplier: node ? Number(node.consumptionMultiplier) : 1,
    domain: node?.domain ?? '',
    hardenUfw: node?.hardening?.ufwLockdown ?? false,
    hardenFail2ban: node?.hardening?.fail2ban ?? false,
    hardenRealisticFallback: node?.hardening?.realisticFallback ?? false,
    hardenSshAllowlist: node?.hardening?.sshAllowlist ?? [],
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  node: Node | null;
  /**
   * On submit, the modal also returns a list of profile IDs the admin
   * picked on step 2. Caller is responsible for creating bindings for each
   * after the node is registered (caller has the binding API + node ID).
   */
  onSubmit: (
    input: CreateNodeInput | UpdateNodeInput,
    profileIds: string[],
  ) => Promise<void>;
  loading?: boolean;
}

export function NodeFormModal({ opened, onClose, node, onSubmit, loading }: Props) {
  const { t } = useTranslation();
  const isEdit = node !== null;
  const [step, setStep] = useState(0);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);

  const form = useForm<FormValues>({
    initialValues: defaults(node),
    validateInputOnBlur: true,
    validate: {
      name: (v) => {
        const trimmed = v.trim();
        if (trimmed.length === 0) return t('validation.nameRequired');
        if (!/^[a-zA-Z0-9._-]+$/.test(trimmed))
          return t('validation.nameLatinOnly');
        return null;
      },
      host: (v) => {
        const trimmed = v.trim();
        if (trimmed.length === 0) return t('validation.addressRequired');
        if (!/^[a-zA-Z0-9.-]+$/.test(trimmed))
          return 'IP / DNS only (no http://, no port)';
        return null;
      },
      port: (v) => {
        if (v === '') return t('validation.portRequired');
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 65535)
          return t('validation.portRange');
        return null;
      },
    },
  });

  // Reset wizard state every time the modal opens fresh (or switches mode).
  useEffect(() => {
    if (opened) {
      setStep(0);
      setSelectedProfileIds([]);
      form.setValues(defaults(node));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, node]);

  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: () => listProfiles(),
    enabled: opened,
  });

  // Profiles split: those matching the node's chosen protocol vs the rest.
  // Matching profiles are deployable today (binary present after install);
  // mismatched ones get a warning + still selectable (admin might be
  // running multi-protocol install separately).
  const profilesByMatch = useMemo(() => {
    const all = profilesQuery.data?.profiles ?? [];
    const match = all.filter((p) => p.protocol === form.values.protocol);
    const mismatch = all.filter((p) => p.protocol !== form.values.protocol);
    return { match, mismatch };
  }, [profilesQuery.data, form.values.protocol]);

  function toggleProfile(id: string) {
    setSelectedProfileIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleClose() {
    form.reset();
    setStep(0);
    setSelectedProfileIds([]);
    onClose();
  }

  async function handleFinalSubmit() {
    const values = form.values;
    // Recombine host + port into the address string the backend expects.
    // Backend Zod accepts `host` or `host:port` - we always send the
    // explicit port form so the cert SAN + cron URL match what the admin
    // saw in the form.
    const portNum =
      values.port === '' ? DEFAULT_NODE_PORT : Number(values.port);
    const address = `${values.host.trim()}:${portNum}`;
    const base = {
      name: values.name,
      address,
      protocol: values.protocol,
      countryCode: values.countryCode || null,
      consumptionMultiplier:
        values.consumptionMultiplier === '' ? 1 : Number(values.consumptionMultiplier),
      domain: values.domain.trim() || null,
      hardening: buildHardening(values),
    };
    if (isEdit) {
      await onSubmit(base satisfies UpdateNodeInput, selectedProfileIds);
    } else {
      await onSubmit(base satisfies CreateNodeInput, selectedProfileIds);
    }
    handleClose();
  }

  function nextStep() {
    if (step === 0) {
      // Belt-and-braces: validate() in Mantine 7 runs validators AND sets
      // form.errors so each input renders its own red message. We block
      // advancement on any error AND highlight the fields visually so the
      // user sees what's wrong.
      const result = form.validate();
      if (result.hasErrors) {
        return;
      }
      setStep(1);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="sm" align="center">
          <Card
            p={8}
            radius="md"
            style={{
              backgroundColor: '#7DD3FC1A',
              border: '1px solid #7DD3FC33',
              color: '#7DD3FC',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconServer2 size={18} />
          </Card>
          <Stack gap={2}>
            <Text style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontWeight: 500, fontSize: 18, color: '#C8D4E3' }}>
              {isEdit ? `${t('modal.nodeNewTitle')} · ${form.values.name}` : t('modal.nodeNewTitle')}
            </Text>
            <Text
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 9,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#7A8BA3',
              }}
            >
              {t('modal.nodeNewSubtitle')}
            </Text>
          </Stack>
        </Group>
      }
      size="lg"
    >
      <Stack>
        <Stepper
          active={step}
          // Жмём по цифре только в рамках уже валидной формы:
          //   - назад (step 1 → 0) разрешено всегда
          //   - вперёд (0 → 1) только если параметры валидны
          // Без проверки stepper позволял прыгнуть мимо required-полей.
          onStepClick={(target) => {
            if (target < step) {
              setStep(target);
              return;
            }
            const result = form.validate();
            if (!result.hasErrors) setStep(target);
          }}
          allowNextStepsSelect={false}
          size="sm"
        >
          <Stepper.Step
            label={t('nodes.form.stepParams')}
            description={t('nodes.form.stepParamsDesc')}
          />
          <Stepper.Step
            label={t('nodes.form.stepProfiles')}
            description={t('nodes.form.stepProfilesDesc', { count: selectedProfileIds.length })}
          />
        </Stepper>

        {step === 0 && (
          <Stack>
            <Group grow>
              <TextInput
                label={t('nodes.form.name')}
                description={t('nodes.form.nameDesc')}
                placeholder="eu-1"
                required
                {...form.getInputProps('name')}
              />
              <Select
                label={t('nodes.form.protocol')}
                description={t('nodes.form.protocolDesc')}
                data={NODE_PROTOCOL_SELECT_DATA}
                allowDeselect={false}
                {...form.getInputProps('protocol')}
              />
            </Group>
            {/* Address split into host + port so admins see exactly what
                port will be hit (default 1337, install-iceslab-node.sh hard-coded).
                Backend recombines into host:port via handleFinalSubmit.
                align=flex-end keeps both inputs on the same baseline even
                when description lines wrap differently between the two. */}
            <Group align="flex-end" gap="sm" wrap="nowrap">
              <TextInput
                style={{ flex: 1 }}
                label={t('nodes.form.address')}
                description={t('nodes.form.addressDesc')}
                placeholder="n1.example.com"
                required
                {...form.getInputProps('host')}
              />
              <NumberInput
                w={140}
                label={t('nodes.form.port')}
                description={t('nodes.form.portDesc')}
                min={1}
                max={65535}
                allowDecimal={false}
                allowNegative={false}
                hideControls
                {...form.getInputProps('port')}
              />
            </Group>
            <Group grow>
              <Select
                label={t('nodes.form.country')}
                description={t('nodes.form.countryDesc')}
                placeholder={t('common.none')}
                data={COUNTRY_OPTIONS}
                searchable
                clearable
                nothingFoundMessage={t('common.nothingFound')}
                {...form.getInputProps('countryCode')}
              />
              <NumberInput
                label={t('nodes.form.multiplier')}
                description={t('nodes.form.multiplierDesc')}
                min={0.1}
                max={10}
                step={0.1}
                allowNegative={false}
                {...form.getInputProps('consumptionMultiplier')}
              />
            </Group>
            <TextInput
              label={t('nodes.form.domain')}
              description={t('nodes.form.domainDesc')}
              placeholder="des-01.example.com"
              {...form.getInputProps('domain')}
            />
            <HardeningSection form={form} />
            <Group justify="space-between" mt="md">
              <Text
                style={{
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: '#7A8BA3',
                }}
              >
                {t('modal.shortcutTabNext')}
              </Text>
              <Group gap="sm">
                <Button variant="default" onClick={handleClose}>
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={nextStep}
                  style={{ backgroundColor: '#2A93D1', color: '#08101A', fontWeight: 500 }}
                >
                  {t('modal.stepNext')}
                </Button>
              </Group>
            </Group>
          </Stack>
        )}

        {step === 1 && (
          <Stack>
            <Alert color="blue" variant="light" icon={<IconRocket size={16} />}>
              {t('nodes.form.profilesAlert')}
            </Alert>

            {profilesQuery.isLoading ? (
              <Text c="dimmed" ta="center" py="md">
                {t('common.loading')}
              </Text>
            ) : (profilesQuery.data?.profiles ?? []).length === 0 ? (
              <Paper withBorder p="md" radius="sm" ta="center">
                <Text c="dimmed" size="sm">
                  {t('nodes.form.noProfiles')}
                </Text>
              </Paper>
            ) : (
              <ScrollArea.Autosize mah={400}>
                <Stack gap="xs">
                  {profilesByMatch.match.length > 0 && (
                    <ProfileGroup
                      title={t('nodes.form.compatibleGroup')}
                      hint={t('nodes.form.compatibleHint', { protocol: form.values.protocol })}
                      color="teal"
                      profiles={profilesByMatch.match}
                      selectedIds={selectedProfileIds}
                      onToggle={toggleProfile}
                    />
                  )}
                  {profilesByMatch.mismatch.length > 0 && (
                    <ProfileGroup
                      title={t('nodes.form.mismatchGroup')}
                      hint={t('nodes.form.mismatchHint')}
                      color="yellow"
                      profiles={profilesByMatch.mismatch}
                      selectedIds={selectedProfileIds}
                      onToggle={toggleProfile}
                    />
                  )}
                </Stack>
              </ScrollArea.Autosize>
            )}

            <Group justify="space-between" mt="md">
              <Text
                style={{
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: '#7A8BA3',
                }}
              >
                {t('modal.shortcutCreateBack')}
              </Text>
              <Group gap="sm">
                <Button variant="default" onClick={() => setStep(0)}>
                  ← {t('common.back')}
                </Button>
                <Button
                  onClick={handleFinalSubmit}
                  loading={loading}
                  leftSection={<IconServer2 size={14} />}
                  style={{ backgroundColor: '#2A93D1', color: '#08101A', fontWeight: 500 }}
                >
                  {isEdit
                    ? t('nodes.form.submitEdit')
                    : selectedProfileIds.length > 0
                      ? t('nodes.form.submitWithBindings', { count: selectedProfileIds.length })
                      : t('nodes.form.submitCreate')}
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

/**
 * G (Zashchita) - additive hardening sub-section. Three probe-resistance
 * switches + an SSH-allowlist tags input. Shares the parent form state via
 * getInputProps so submit picks the values up through buildHardening.
 */
function HardeningSection({
  form,
}: {
  form: UseFormReturnType<FormValues>;
}) {
  const { t } = useTranslation();
  return (
    <Card withBorder radius="md" p="sm" mt="xs">
      <Group gap={8} mb="xs">
        <ThemeIcon size={26} radius="md" variant="light" color="teal">
          <IconShieldLock size={14} />
        </ThemeIcon>
        <Stack gap={0}>
          <Text fw={600} size="sm">
            {t('nodes.form.hardeningSection')}
          </Text>
          <Text size="xs" c="dimmed">
            {t('nodes.form.hardeningSectionDesc')}
          </Text>
        </Stack>
      </Group>
      <Stack gap="sm">
        <Switch
          label={t('nodes.form.hardeningUfw')}
          description={t('nodes.form.hardeningUfwDesc')}
          {...form.getInputProps('hardenUfw', { type: 'checkbox' })}
        />
        <Switch
          label={t('nodes.form.hardeningFail2ban')}
          description={t('nodes.form.hardeningFail2banDesc')}
          {...form.getInputProps('hardenFail2ban', { type: 'checkbox' })}
        />
        <Switch
          label={t('nodes.form.hardeningRealisticFallback')}
          description={t('nodes.form.hardeningRealisticFallbackDesc')}
          {...form.getInputProps('hardenRealisticFallback', { type: 'checkbox' })}
        />
        <TagsInput
          label={t('nodes.form.hardeningSshAllowlist')}
          description={t('nodes.form.hardeningSshAllowlistDesc')}
          placeholder="203.0.113.4, 10.0.0.0/8"
          clearable
          {...form.getInputProps('hardenSshAllowlist')}
        />
      </Stack>
    </Card>
  );
}

function ProfileGroup({
  title,
  hint,
  color,
  profiles,
  selectedIds,
  onToggle,
}: {
  title: string;
  hint: string;
  color: string;
  profiles: Profile[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <Box>
      <Group gap={6} mb={4}>
        <Badge variant="light" color={color} size="sm">
          {title}
        </Badge>
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      </Group>
      <Stack gap={4}>
        {profiles.map((p) => {
          const checked = selectedIds.includes(p.id);
          return (
            <Group
              key={p.id}
              wrap="nowrap"
              gap="sm"
              px="sm"
              py={8}
              onClick={() => onToggle(p.id)}
              style={{
                cursor: 'pointer',
                borderRadius: 6,
                background: checked
                  ? 'var(--mantine-color-dark-5)'
                  : 'var(--mantine-color-dark-6)',
                transition: 'background 0.1s',
              }}
            >
              <Checkbox checked={checked} readOnly tabIndex={-1} />
              <ThemeIcon variant="light" color={color} size="sm">
                <IconBolt size={12} />
              </ThemeIcon>
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6} wrap="nowrap">
                  <Text size="sm" fw={500} truncate>
                    {p.name}
                  </Text>
                  <Badge variant="light" color="cyan" size="xs" tt="uppercase">
                    {p.protocol}
                  </Badge>
                  {!p.enabled && (
                    <Badge variant="default" color="gray" size="xs">
                      off
                    </Badge>
                  )}
                </Group>
                {p.description && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {p.description}
                  </Text>
                )}
              </Stack>
            </Group>
          );
        })}
      </Stack>
    </Box>
  );
}
