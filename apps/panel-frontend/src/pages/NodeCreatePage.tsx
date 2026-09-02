import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Collapse,
  NumberInput,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createBinding,
  createNode,
  findNode,
  listProfiles,
  type NodeHardening,
  type NodeProtocol,
  type NodeWithPayload,
  type Profile,
} from '../lib/api';
import { COUNTRY_OPTIONS } from '../lib/countries';
import { protocolLabel } from '../lib/protocols';
import { usePageMeta } from '../hooks/usePageMeta';

/**
 * Register a node, as a page in three steps: parameters, hosts, install. A node
 * is a machine an operator is about to hand credentials to, so the decisions
 * get the width of the page and a visible position in the sequence rather than
 * a dialog that scrolls inside itself.
 *
 * This file currently owns step 1. Steps 2 and 3 are drawn against their own
 * artboards next; until then the bar's forward action stops at the end of the
 * parameters step.
 */

const HAIRLINE = '#1C2A3D';
const EDGE = '#2C3A4E';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const GROUND = '#08101A';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const VIOLET = '#A78BFA';

const DISPLAY = "'Space Grotesk Variable', 'Space Grotesk', 'Inter Variable', Inter, sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

// Default mTLS port the node-agent listens on, hard-coded in the installer.
const DEFAULT_NODE_PORT = 1337;

const PROTOCOL_OPTIONS: { value: NodeProtocol; label: string }[] = [
  { value: 'xray', label: 'Xray' },
  { value: 'hysteria', label: 'Hysteria 2' },
  { value: 'amneziawg', label: 'AmneziaWG' },
  { value: 'naive', label: 'NaiveProxy' },
  { value: 'shadowsocks', label: 'Shadowsocks 2022' },
  { value: 'mtproto', label: 'MTProto (Telegram-only)' },
  { value: 'mieru', label: 'Mieru (stealth proxy)' },
  { value: 'tuic', label: 'TUIC' },
  { value: 'anytls', label: 'AnyTLS' },
  { value: 'shadowtls', label: 'ShadowTLS' },
];
const SINGBOX_NODE_PROTOCOLS: NodeProtocol[] = ['tuic', 'anytls', 'shadowtls'];
const SINGBOX_ENGINE_CAPABLE: NodeProtocol[] = ['xray', 'hysteria', 'shadowsocks'];
const NODE_PROTOCOL_GROUPED = [
  ...PROTOCOL_OPTIONS.filter((p) => !SINGBOX_NODE_PROTOCOLS.includes(p.value)),
  {
    group: 'sing-box',
    items: PROTOCOL_OPTIONS.filter((p) => SINGBOX_NODE_PROTOCOLS.includes(p.value)),
  },
];

interface FormValues {
  name: string;
  host: string;
  port: number | '';
  protocol: NodeProtocol;
  countryCode: string;
  consumptionMultiplier: number | '';
  domain: string;
  singboxEngine: boolean;
  hardenUfw: boolean;
  hardenFail2ban: boolean;
  hardenRealisticFallback: boolean;
  hardenSshAllowlist: string[];
}

/**
 * On this page the hint belongs UNDER the control, the way the artboard reads
 * it: label, the thing you type into, then the sentence explaining what you
 * just typed. Mantine's default puts the description above the input, which
 * pushes two side-by-side fields off each other's baseline whenever one hint
 * wraps and the other does not.
 */
const FIELD = {
  inputWrapperOrder: ['label', 'input', 'description', 'error'] as (
    | 'label'
    | 'input'
    | 'description'
    | 'error'
  )[],
  styles: {
    description: {
      color: FAINT,
      fontFamily: DISPLAY,
      fontSize: 11,
      lineHeight: '15px',
      marginTop: 6,
    },
  },
};

// Listen ports handed to new hosts, in preference order. Mirrors the backend's
// CANDIDATE_PORTS so the ports promised here are the ports actually bound.
const CANDIDATE_PORTS = [443, 8443, 2053, 2083, 2087, 2096];

/** Next candidate port not already handed to another host on this node. */
function pickFreePort(used: number[]): number {
  const taken = new Set(used);
  for (const p of CANDIDATE_PORTS) if (!taken.has(p)) return p;
  for (let p = 20000; p <= 65000; p++) if (!taken.has(p)) return p;
  return 443;
}

/** What the third step needs to remember about the node it just registered. */
interface Registered {
  id: string;
  name: string;
  address: string;
  token: string;
  expiresAt: string;
  command: string;
  payload: string;
  /** Profile name and port per host that was attached, for the timeline. */
  hosts: { name: string; port: number }[];
}

export function NodeCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [groupOpen, setGroupOpen] = useState({ can: true, cannot: true });
  const [registered, setRegistered] = useState<Registered | null>(null);
  const [creating, setCreating] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [copied, setCopied] = useState<'token' | 'command' | null>(null);

  const form = useForm<FormValues>({
    initialValues: {
      name: '',
      host: '',
      port: DEFAULT_NODE_PORT,
      protocol: 'xray',
      countryCode: '',
      consumptionMultiplier: 1,
      domain: '',
      singboxEngine: false,
      hardenUfw: false,
      hardenFail2ban: false,
      hardenRealisticFallback: false,
      hardenSshAllowlist: [],
    },
    validateInputOnBlur: true,
    validate: {
      name: (v) => {
        const trimmed = v.trim();
        if (trimmed.length === 0) return t('validation.nameRequired');
        if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) return t('validation.nameLatinOnly');
        return null;
      },
      host: (v) => {
        const trimmed = v.trim();
        if (trimmed.length === 0) return t('validation.addressRequired');
        if (!/^[a-zA-Z0-9.-]+$/.test(trimmed)) return t('validation.addressHostOnly');
        return null;
      },
      port: (v) => {
        if (v === '') return t('validation.portRequired');
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 65535) return t('validation.portRange');
        return null;
      },
    },
  });

  usePageMeta([t('nodeCreate.crumb')]);

  // Watch for the agent's first check-in. There is no single-node endpoint, so
  // findNode walks the list; the poll stops the moment the node reports online.
  const registeredId = registered?.id ?? null;
  const [isOnline, setIsOnline] = useState(false);
  const nodeWatch = useQuery({
    queryKey: ['node', 'watch', registeredId],
    queryFn: () => findNode(registeredId!),
    enabled: step === 2 && registeredId !== null && !isOnline,
    refetchInterval: 5000,
  });
  useEffect(() => {
    if (nodeWatch.data?.status === 'online') setIsOnline(true);
  }, [nodeWatch.data]);

  // Seconds since the node was registered, for the "waiting" clock.
  const [waited, setWaited] = useState(0);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (step !== 2 || isOnline) return;
    if (startedAt.current === null) startedAt.current = Date.now();
    const id = window.setInterval(() => {
      setWaited(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [step, isOnline]);

  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: () => listProfiles(),
    enabled: step === 1,
  });

  // A host can land here only if this node will run the core its profile needs:
  // the node's own core, or anything on sing-box when that engine is installed
  // too. Everything else is listed with the reason it cannot, rather than
  // hidden, so the operator sees the whole inventory and why it is short.
  const groups = useMemo(() => {
    const all = profilesQuery.data?.profiles ?? [];
    const can: Profile[] = [];
    const cannot: { profile: Profile; reason: string }[] = [];
    for (const p of all) {
      const nativeMatch = p.engine !== 'singbox' && p.protocol === form.values.protocol;
      const singboxMatch = p.engine === 'singbox' && form.values.singboxEngine;
      if (nativeMatch || singboxMatch) {
        can.push(p);
      } else {
        cannot.push({
          profile: p,
          reason:
            p.engine === 'singbox'
              ? t('nodeCreate.reasonNoSingbox')
              : t('nodeCreate.reasonNoCore', { protocol: p.protocol }),
        });
      }
    }
    return { can, cannot };
  }, [profilesQuery.data, form.values.protocol, form.values.singboxEngine, t]);

  // Ports are assigned in selection order, so the chip on a row is the port
  // that row will actually listen on once the node registers.
  const portByProfile = useMemo(() => {
    const map = new Map<string, number>();
    const used: number[] = [];
    for (const id of selected) {
      const port = pickFreePort(used);
      used.push(port);
      map.set(id, port);
    }
    return map;
  }, [selected]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAllCan() {
    const ids = groups.can.map((p) => p.id);
    const allOn = ids.length > 0 && ids.every((id) => selected.includes(id));
    setSelected((prev) => (allOn ? prev.filter((x) => !ids.includes(x)) : [...new Set([...prev, ...ids])]));
  }

  function goNext() {
    if (step === 0) {
      const result = form.validate();
      if (result.hasErrors) return;
      setStep(1);
    }
  }

  /**
   * Register the node, then attach each picked host. The bootstrap token only
   * exists in the create response, so step 3 can be reached exactly once and
   * only through here.
   */
  async function register() {
    if (creating) return;
    setCreating(true);
    try {
      const port = form.values.port === '' ? DEFAULT_NODE_PORT : Number(form.values.port);
      const node: NodeWithPayload = await createNode({
        name: form.values.name.trim(),
        address: `${form.values.host.trim()}:${port}`,
        protocol: form.values.protocol,
        countryCode: form.values.countryCode || null,
        consumptionMultiplier:
          form.values.consumptionMultiplier === '' ? 1 : Number(form.values.consumptionMultiplier),
        domain: form.values.domain.trim() || null,
        hardening: buildHardening(form.values),
        singboxEngine:
          SINGBOX_ENGINE_CAPABLE.includes(form.values.protocol) && form.values.singboxEngine,
      });

      // Bindings go one at a time; there is no batch endpoint. A host that
      // fails is reported by name rather than swallowed, because the node is
      // already registered by then and the operator has to know what is short.
      const hosts: { name: string; port: number }[] = [];
      const failed: string[] = [];
      for (const id of selected) {
        const profile = groups.can.find((p) => p.id === id);
        const hostPort = portByProfile.get(id) ?? DEFAULT_NODE_PORT;
        if (!profile) continue;
        try {
          await createBinding({
            profileId: id,
            nodeId: node.id,
            port: hostPort,
            publicHost: form.values.host.trim(),
            publicPort: hostPort,
          });
          hosts.push({ name: profile.name, port: hostPort });
        } catch {
          failed.push(profile.name);
        }
      }
      if (failed.length > 0) {
        notifications.show({
          color: 'yellow',
          title: t('nodeCreate.hostsPartialTitle'),
          message: t('nodeCreate.hostsPartial', { names: failed.join(', ') }),
        });
      }

      qc.invalidateQueries({ queryKey: ['nodes'] });
      qc.invalidateQueries({ queryKey: ['profiles'] });
      setRegistered({
        id: node.id,
        name: node.name,
        address: node.address,
        token: node.bootstrap.token,
        expiresAt: node.bootstrap.expiresAt,
        command: node.bootstrap.command,
        payload: node.payload,
        hosts,
      });
      setStep(2);
    } catch (err) {
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCreating(false);
    }
  }

  async function copy(text: string, what: 'token' | 'command') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      notifications.show({ color: 'red', message: t('nodeCreate.copyFailed') });
    }
  }

  function downloadPayload() {
    if (!registered) return;
    const blob = new Blob([registered.payload], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${registered.name}-payload.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 16, flexShrink: 0 }}>
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
            {step === 2 ? <TickIcon size={18} color={MOSS} /> : <ServerIcon size={18} color={MOSS} />}
          </Box>
          {/* Once the machine has a name, the bar wears it: from here on the
              page is about that node, not about "a new node". */}
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {step === 2
              ? t('nodeCreate.registered', { name: registered?.name ?? form.values.name.trim() })
              : step === 0 || !form.values.name.trim()
                ? t('nodeCreate.title')
                : form.values.name.trim()}
          </Text>
        </Box>
        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, paddingLeft: 16 }}>
          {step === 0 ? (
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: '0.12em',
                lineHeight: '12px',
                textTransform: 'uppercase',
                color: MIST,
              }}
            >
              {t('nodeCreate.subtitle')}
            </Text>
          ) : step === 2 ? (
            <>
              {/* The node exists but has not phoned home yet: that gap is the
                  whole point of this step, so it leads the line. */}
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 22,
                  paddingInline: 8,
                  borderRadius: 6,
                  backgroundColor: isOnline ? `${MOSS}14` : `${AMBER}14`,
                  border: `1px solid ${isOnline ? `${MOSS}2E` : `${AMBER}2E`}`,
                }}
              >
                <Box
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: isOnline ? MOSS : AMBER,
                    flexShrink: 0,
                  }}
                />
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    lineHeight: '12px',
                    textTransform: 'uppercase',
                    color: isOnline ? MOSS : AMBER,
                  }}
                >
                  {isOnline ? t('nodeCreate.agentOnline') : t('nodeCreate.waitingAgent')}
                </Text>
              </Box>
              <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>
                {registered?.address}
              </Text>
            </>
          ) : (
            <>
              <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>
                {form.values.host.trim()}:{form.values.port === '' ? DEFAULT_NODE_PORT : form.values.port}
              </Text>
              <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM }}>·</Text>
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 20,
                  paddingInline: 8,
                  borderRadius: 5,
                  backgroundColor: `${VIOLET}1A`,
                  border: `1px solid ${VIOLET}33`,
                }}
              >
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    lineHeight: '12px',
                    textTransform: 'uppercase',
                    color: VIOLET,
                  }}
                >
                  {form.values.protocol}
                </Text>
              </Box>
            </>
          )}
          <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM }}>·</Text>
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 22,
              paddingInline: 9,
              borderRadius: 6,
              backgroundColor: WELL,
              border: `1px solid ${EDGE}`,
            }}
          >
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: '0.12em',
                lineHeight: '12px',
                textTransform: 'uppercase',
                color: MIST,
              }}
            >
              {t('nodeCreate.stepOf', { step: step + 1, total: STEPS.length })}
            </Text>
          </Box>
        </Box>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, flexShrink: 0 }}>
          {step === 0 ? (
            <>
              <BarButton onClick={() => navigate('/nodes')}>{t('common.cancel')}</BarButton>
              <BarButton primary icon="arrow" onClick={goNext}>
                {t('nodeCreate.nextHosts')}
              </BarButton>
            </>
          ) : step === 1 ? (
            <>
              <BarButton icon="back" onClick={() => setStep(0)}>
                {t('common.back')}
              </BarButton>
              <BarButton primary icon="server" onClick={register} disabled={creating}>
                {creating
                  ? t('nodeCreate.creating')
                  : selected.length > 0
                    ? t('nodeCreate.createWithHosts', { count: selected.length })
                    : t('nodeCreate.createOnly')}
              </BarButton>
            </>
          ) : (
            // No way back from here: the token is shown once, so the only
            // action is to confirm it has been taken somewhere safe.
            <BarButton primary icon="tick" onClick={() => navigate('/nodes')}>
              {t('nodeCreate.savedIt')}
            </BarButton>
          )}
        </Box>
      </Box>

      {/* Where in the sequence we are. The line between two markers is the
          sequence itself, so it stretches instead of the labels. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '14px 20px',
          borderRadius: 10,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        {STEPS.map((s, i) => {
          const active = i === step;
          return (
            <Box key={s.key} style={{ display: 'contents' }}>
              {i > 0 && <Box style={{ flex: 1, minWidth: 0, height: 1, backgroundColor: HAIRLINE }} />}
              <Box style={{ display: 'flex', alignItems: 'center', gap: 11, flexShrink: 0 }}>
                <Box
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    backgroundColor: active ? `${CYAN}14` : WELL,
                    border: `1px solid ${active ? CYAN : EDGE}`,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      fontWeight: 600,
                      lineHeight: '14px',
                      color: active ? CYAN : MIST,
                    }}
                  >
                    {i + 1}
                  </Text>
                </Box>
                <Stack gap={2}>
                  <Text
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      lineHeight: '17px',
                      color: active ? SNOW : MIST,
                    }}
                  >
                    {t(s.label)}
                  </Text>
                  <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '14px', color: FAINT }}>
                    {t(s.hint, { count: selected.length })}
                  </Text>
                </Stack>
              </Box>
            </Box>
          );
        })}
      </Box>

      {step === 0 && (
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
                <Select
                  {...FIELD}
                  style={{ flex: 1, minWidth: 0 }}
                  label={t('nodes.form.protocol')}
                  description={t('nodes.form.protocolDesc')}
                  data={NODE_PROTOCOL_GROUPED}
                  allowDeselect={false}
                  {...form.getInputProps('protocol')}
                />
              </Box>

              {/* Engine choice is a claim about the machine, not a field: it
                  changes the install command, so it reads as its own row. */}
              {SINGBOX_ENGINE_CAPABLE.includes(form.values.protocol) && (
                <ToggleRow
                  checked={form.values.singboxEngine}
                  onChange={(v) => form.setFieldValue('singboxEngine', v)}
                  title={t('nodes.form.singboxEngine')}
                  hint={t('nodes.form.singboxEngineDesc')}
                  titleSize={13}
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
      )}

      {step === 1 && (
        <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0 }}>
            <Stack
              gap={14}
              style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
            >
              <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                <BoltIcon size={15} color={CYAN} />
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: MIST,
                  }}
                >
                  {t('nodeCreate.attachTitle')}
                </Text>
                <Chip color={CYAN}>{t('nodeCreate.selectedCount', { count: selected.length })}</Chip>
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT, flex: 1, minWidth: 0 }}>
                  {t('nodeCreate.attachHint')}
                </Text>
              </Box>

              {profilesQuery.isLoading && (
                <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: MIST }}>{t('common.loading')}</Text>
              )}

              {groups.can.length > 0 && (
                <HostGroup
                  accent={MOSS}
                  chip={t('nodeCreate.canAttach')}
                  chipColor={MOSS}
                  hint={t('nodeCreate.canAttachHint', { protocol: protocolLabel(form.values.protocol) })}
                  count={`${groups.can.filter((p) => selected.includes(p.id)).length}/${groups.can.length}`}
                  open={groupOpen.can}
                  onToggleOpen={() => setGroupOpen((s) => ({ ...s, can: !s.can }))}
                  allChecked={groups.can.length > 0 && groups.can.every((p) => selected.includes(p.id))}
                  onToggleAll={toggleAllCan}
                >
                  {groups.can.map((p) => {
                    const checked = selected.includes(p.id);
                    return (
                      <HostRow
                        key={p.id}
                        selectable
                        checked={checked}
                        onClick={() => toggle(p.id)}
                        name={p.name}
                        meta={profileMeta(p)}
                        trailing={
                          checked ? (
                            <Chip>{t('nodeCreate.portChip', { port: portByProfile.get(p.id) })}</Chip>
                          ) : null
                        }
                      />
                    );
                  })}
                </HostGroup>
              )}

              {groups.cannot.length > 0 && (
                <HostGroup
                  accent={AMBER}
                  chip={t('nodeCreate.cannotAttach')}
                  chipColor={AMBER}
                  hint={t('nodeCreate.cannotAttachHint')}
                  count={`0/${groups.cannot.length}`}
                  open={groupOpen.cannot}
                  onToggleOpen={() => setGroupOpen((s) => ({ ...s, cannot: !s.cannot }))}
                >
                  {groups.cannot.map(({ profile: p, reason }) => (
                    <HostRow
                      key={p.id}
                      checked={false}
                      name={p.name}
                      meta={profileMeta(p)}
                      trailing={<Chip color={AMBER}>{reason}</Chip>}
                    />
                  ))}
                </HostGroup>
              )}
            </Stack>
          </Box>

          {/* What the button will actually do, spelled out before it is
              pressed. Nothing here has touched the VPS yet. */}
          <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 520, flexShrink: 0 }}>
            <Stack
              gap={14}
              style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
            >
              <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <EyeIcon size={15} color={CYAN} />
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: MIST,
                  }}
                >
                  {t('nodeCreate.summaryTitle')}
                </Text>
              </Box>

              <Box
                style={{
                  borderRadius: 10,
                  backgroundColor: WELL,
                  border: `1px solid ${HAIRLINE}`,
                  overflow: 'hidden',
                }}
              >
                <SummaryRow
                  label={t('nodeCreate.sumNode')}
                  value={`${form.values.name.trim() || '-'} · ${form.values.protocol}`}
                />
                <SummaryRow
                  label={t('nodeCreate.sumEndpoint')}
                  value={`${form.values.host.trim() || '-'}:${
                    form.values.port === '' ? DEFAULT_NODE_PORT : form.values.port
                  }`}
                />
                <SummaryRow label={t('nodeCreate.sumHardening')} value={hardeningSummary(form.values, t)} />
                <SummaryRow
                  label={t('nodeCreate.sumHosts')}
                  value={
                    selected.length === 0
                      ? t('nodeCreate.sumHostsNone')
                      : t('nodeCreate.sumHostsValue', {
                          count: selected.length,
                          ports: selected.map((id) => portByProfile.get(id)).join(', '),
                        })
                  }
                />
              </Box>

              <Box
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '12px 14px',
                  borderRadius: 10,
                  backgroundColor: `${CYAN}0D`,
                  border: `1px solid ${CYAN}29`,
                }}
              >
                <InfoIcon size={14} color={CYAN} />
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: MIST, flex: 1 }}>
                  {t('nodeCreate.summaryNote')}
                </Text>
              </Box>
            </Stack>
          </Box>
        </Box>
      )}

      {step === 2 && registered && (
        <>
          {/* The one-shot nature of the token is the first thing on the page,
              above everything it is needed for. */}
          <Box
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '13px 16px',
              borderRadius: 10,
              backgroundColor: `${AMBER}0D`,
              border: `1px solid ${AMBER}29`,
            }}
          >
            <WarnIcon size={16} color={AMBER} />
            <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, lineHeight: '17px', color: SNOW }}>
                {t('nodeCreate.onceTitle')}
              </Text>
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}>
                {t('nodeCreate.onceBody')}
              </Text>
            </Stack>
          </Box>

          <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 20, width: '100%' }}>
            <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0 }}>
              <Stack
                gap={12}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <KeyIcon size={15} color={CYAN} />
                  <CardCaption>{t('nodeCreate.tokenTitle')}</CardCaption>
                  <Box style={{ flex: 1, minWidth: 0 }} />
                  <Chip color={AMBER}>{expiryLabel(registered.expiresAt, t)}</Chip>
                </Box>
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 14px',
                    borderRadius: 8,
                    backgroundColor: GROUND,
                    border: `1px solid ${HAIRLINE}`,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      lineHeight: '16px',
                      color: SNOW,
                      flex: 1,
                      minWidth: 0,
                      wordBreak: 'break-all',
                    }}
                  >
                    {registered.token}
                  </Text>
                  <SmallButton
                    icon="copy"
                    accent
                    onClick={() => copy(registered.token, 'token')}
                    height={26}
                    radius={7}
                  >
                    {copied === 'token' ? t('nodeCreate.copied') : t('common.copy')}
                  </SmallButton>
                </Box>
              </Stack>

              <Stack
                gap={12}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <TerminalIcon size={15} color={CYAN} />
                  <CardCaption>{t('nodeCreate.runTitle')}</CardCaption>
                  <Box style={{ flex: 1, minWidth: 0 }} />
                  <SmallButton icon="copy" accent onClick={() => copy(registered.command, 'command')}>
                    {copied === 'command' ? t('nodeCreate.copied') : t('nodeCreate.copyCommand')}
                  </SmallButton>
                </Box>
                {/* The fetch line is moss, the flags stay snow: the eye lands
                    on the one line that reaches the network. */}
                <Box
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: 14,
                    borderRadius: 8,
                    backgroundColor: GROUND,
                    border: `1px solid ${HAIRLINE}`,
                  }}
                >
                  {splitCommand(registered.command).map((line, i) => (
                    <Text
                      key={i}
                      style={{
                        fontFamily: MONO,
                        fontSize: 12,
                        lineHeight: '19px',
                        color: i === 0 ? MOSS : SNOW,
                        wordBreak: 'break-all',
                      }}
                    >
                      {line}
                    </Text>
                  ))}
                </Box>
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
                  {t('nodeCreate.runHint')}
                </Text>
              </Stack>

              <Stack
                gap={12}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <FileIcon size={15} color={MIST} />
                  <CardCaption>{t('nodeCreate.manualTitle')}</CardCaption>
                  <Box
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      height: 18,
                      paddingInline: 7,
                      borderRadius: 5,
                      backgroundColor: WELL,
                      border: `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: MONO,
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        lineHeight: '11px',
                        textTransform: 'uppercase',
                        color: FAINT,
                      }}
                    >
                      {t('nodeCreate.advanced')}
                    </Text>
                  </Box>
                  <Box style={{ flex: 1, minWidth: 0 }} />
                  <SmallButton icon="chevron" open={showPayload} onClick={() => setShowPayload((v) => !v)}>
                    {t('nodeCreate.showPayload')}
                  </SmallButton>
                  <SmallButton icon="download" accent onClick={downloadPayload}>
                    {t('nodeCreate.downloadPayload')}
                  </SmallButton>
                </Box>
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
                  {t('nodeCreate.manualHint')}
                </Text>
                <Collapse in={showPayload}>
                  <Box
                    style={{
                      padding: 14,
                      borderRadius: 8,
                      backgroundColor: GROUND,
                      border: `1px solid ${HAIRLINE}`,
                      maxHeight: 220,
                      overflow: 'auto',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: MONO,
                        fontSize: 11,
                        lineHeight: '17px',
                        color: MIST,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {registered.payload}
                    </Text>
                  </Box>
                </Collapse>
              </Stack>
            </Box>

            <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 520, flexShrink: 0 }}>
              <Stack
                gap={14}
                style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
              >
                <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ClockIcon size={15} color={CYAN} />
                  <CardCaption>{t('nodeCreate.nextTitle')}</CardCaption>
                </Box>

                <TimelineStep
                  state="done"
                  title={t('nodeCreate.tl1')}
                  hint={t('nodeCreate.tl1Hint')}
                />
                <TimelineStep
                  state={isOnline ? 'done' : 'current'}
                  title={t('nodeCreate.tl2')}
                  hint={t('nodeCreate.tl2Hint')}
                />
                <TimelineStep
                  state={isOnline ? 'done' : 'pending'}
                  title={t('nodeCreate.tl3')}
                  hint={t('nodeCreate.tl3Hint')}
                />
                <TimelineStep
                  state={isOnline ? 'current' : 'pending'}
                  title={t('nodeCreate.tl4', { count: registered.hosts.length })}
                  hint={
                    registered.hosts.length > 0
                      ? registered.hosts.map((h) => `${h.name} on ${h.port}`).join(', ')
                      : t('nodeCreate.tl4None')
                  }
                />

                <Box style={{ height: 1, backgroundColor: HAIRLINE, width: '100%' }} />

                <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                  <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, flex: 1 }}>
                    {isOnline ? t('nodeCreate.heartbeatGot') : t('nodeCreate.heartbeatWait')}
                  </Text>
                  <Box
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      height: 24,
                      paddingInline: 9,
                      borderRadius: 6,
                      backgroundColor: WELL,
                      border: `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <Box
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: isOnline ? MOSS : AMBER,
                        flexShrink: 0,
                      }}
                    />
                    <Text
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        lineHeight: '12px',
                        color: isOnline ? MOSS : AMBER,
                      }}
                    >
                      {clock(waited)}
                    </Text>
                  </Box>
                </Box>
              </Stack>
            </Box>
          </Box>
        </>
      )}

      <Box style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', lineHeight: '12px', color: FAINT }}>
          {t('nodeCreate.footerHint')}
        </Text>
      </Box>
    </Stack>
  );
}

const STEPS = [
  { key: 'params', label: 'nodeCreate.step1', hint: 'nodeCreate.step1Hint' },
  { key: 'hosts', label: 'nodeCreate.step2', hint: 'nodeCreate.step2Hint' },
  { key: 'install', label: 'nodeCreate.step3', hint: 'nodeCreate.step3Hint' },
] as const;

/**
 * Collapse the flat hardening fields into the blob the API stores. Null when
 * nothing is on, so an ordinary node keeps hardening = NULL and its install
 * command stays byte-identical to the default one.
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

/** mm:ss for the heartbeat clock. */
function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** How long the token has left, in whole minutes. */
function expiryLabel(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const left = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  return left <= 0 ? t('nodeCreate.expired') : t('nodeCreate.expiresIn', { min: left });
}

/**
 * Break the one-liner where the installer's own flags start, so a 300-char
 * command reads as four lines instead of one wrapped smear.
 */
function splitCommand(cmd: string): string[] {
  const parts = cmd
    .split(/\s+(?=--)/)
    // The command may already carry its own line continuations; strip them so
    // the rendered block does not end up with a double backslash per line.
    .map((p) => p.replace(/\s*\\\s*$/, '').trim())
    .filter(Boolean);
  return parts.map((p, i) => (i === parts.length - 1 ? p : `${p} \\`));
}

/** One line of the profile's shape, in the operator's shorthand. */
function profileMeta(p: Profile): string {
  const cfg = p.config as Record<string, unknown>;
  const bits: string[] = [];
  if (p.protocol === 'xray') {
    const sec = String(cfg['security'] ?? '');
    const net = String(cfg['network'] ?? '');
    if (sec === 'reality') bits.push('REALITY');
    else if (sec) bits.push(sec.toUpperCase());
    if (net) bits.push(net);
    if (cfg['realityMode'] === 'self-steal') bits.push('self-steal');
  } else {
    bits.push(p.protocol);
    const method = cfg['method'];
    if (typeof method === 'string') bits.push(method);
  }
  if (p.engine === 'singbox') bits.push('sing-box');
  return bits.filter(Boolean).join(' · ');
}

/** Which hardening switches are on, as one line for the summary table. */
function hardeningSummary(
  v: { hardenUfw: boolean; hardenFail2ban: boolean; hardenRealisticFallback: boolean; hardenSshAllowlist: string[] },
  t: (k: string) => string,
): string {
  const on: string[] = [];
  if (v.hardenUfw) on.push('ufw');
  if (v.hardenFail2ban) on.push('fail2ban');
  if (v.hardenRealisticFallback) on.push('fallback');
  if (v.hardenSshAllowlist.length > 0) on.push(`ssh-allowlist(${v.hardenSshAllowlist.length})`);
  return on.length > 0 ? on.join(', ') : t('nodeCreate.sumHardeningNone');
}

/**
 * A verdict group: hosts that can land on this node, or hosts that cannot and
 * the reason each is out. The verdict colours the left edge, so the two blocks
 * read apart before a single word is read.
 */
function HostGroup({
  accent,
  chip,
  chipColor,
  hint,
  count,
  open,
  onToggleOpen,
  allChecked,
  onToggleAll,
  children,
}: {
  accent: string;
  chip: string;
  chipColor: string;
  hint: string;
  count: string;
  open: boolean;
  onToggleOpen: () => void;
  allChecked?: boolean;
  onToggleAll?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Box
      style={{
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${accent}`,
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', width: '100%' }}>
        <UnstyledButton type="button" onClick={onToggleOpen} style={{ display: 'flex', flexShrink: 0 }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 120ms' }}
          >
            <path
              d="M6 9l6 6l6 -6"
              fill="none"
              stroke={MIST}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </UnstyledButton>
        <Chip color={chipColor}>{chip}</Chip>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT, flex: 1, minWidth: 0 }}>
          {hint}
        </Text>
        <Chip edge>{count}</Chip>
        <CheckCircle checked={!!allChecked} onClick={onToggleAll} />
      </Box>
      <Collapse in={open}>{children}</Collapse>
    </Box>
  );
}

/** One host row. Selected rows lift to the raised well so the eye can count. */
function HostRow({
  selectable,
  checked,
  onClick,
  name,
  meta,
  trailing,
}: {
  selectable?: boolean;
  checked: boolean;
  onClick?: () => void;
  name: string;
  meta: string;
  trailing?: React.ReactNode;
}) {
  return (
    <Box
      onClick={selectable ? onClick : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 14px 11px 38px',
        borderTop: `1px solid ${HAIRLINE}`,
        backgroundColor: checked ? '#152233' : 'transparent',
        cursor: selectable ? 'pointer' : 'default',
        width: '100%',
      }}
    >
      <CheckCircle checked={checked} />
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '16px',
          color: checked ? SNOW : MIST,
          flex: 1,
          minWidth: 0,
        }}
      >
        {name}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: checked ? MIST : FAINT }}>{meta}</Text>
      {trailing}
    </Box>
  );
}

/** 14px ring that fills with a cyan tick when on. */
function CheckCircle({ checked, onClick }: { checked: boolean; onClick?: () => void }) {
  return (
    <Box
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      style={{
        width: 14,
        height: 14,
        borderRadius: 999,
        border: `1px solid ${checked ? CYAN : DIM}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        cursor: onClick ? 'pointer' : 'inherit',
      }}
    >
      {checked && (
        <svg width="8" height="8" viewBox="0 0 24 24">
          <path
            d="M5 12l5 5L20 7"
            fill="none"
            stroke={CYAN}
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </Box>
  );
}

/** Small mono pill. `edge` uses the lighter hairline for neutral counters. */
function Chip({ children, color, edge }: { children: React.ReactNode; color?: string; edge?: boolean }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 20,
        paddingInline: 8,
        borderRadius: 6,
        flexShrink: 0,
        backgroundColor: color ? `${color}14` : WELL,
        border: `1px solid ${color ? `${color}2E` : edge ? EDGE : HAIRLINE}`,
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: color ? '0.1em' : undefined,
          lineHeight: '12px',
          color: color ?? MIST,
        }}
      >
        {children}
      </Text>
    </Box>
  );
}

/** The mono caption every card on this page wears. */
function CardCaption({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        lineHeight: '12px',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}

/** Compact action inside a card header or field. */
function SmallButton({
  children,
  icon,
  accent,
  open,
  height = 28,
  radius = 8,
  onClick,
}: {
  children: React.ReactNode;
  icon?: 'copy' | 'chevron' | 'download';
  accent?: boolean;
  open?: boolean;
  height?: number;
  radius?: number;
  onClick?: () => void;
}) {
  const stroke = accent ? CYAN : MIST;
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        height,
        paddingInline: height >= 28 ? 12 : 10,
        borderRadius: radius,
        backgroundColor: accent && height < 28 ? CARD : WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
      }}
    >
      {icon === 'copy' && (
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke={stroke} strokeWidth="2" />
          <path
            d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {icon === 'download' && (
        <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M12 4v12" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
          <path
            d="M7 12l5 5l5 -5"
            fill="none"
            stroke={stroke}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M5 20h14" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: height >= 28 ? 12 : 11,
          fontWeight: 500,
          lineHeight: height >= 28 ? '16px' : '15px',
          color: accent ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
      {icon === 'chevron' && (
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}
        >
          <path
            d="M6 9l6 6l6 -6"
            fill="none"
            stroke={MIST}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </UnstyledButton>
  );
}

/**
 * One beat of what happens after the button. Done wears a moss tick, the beat
 * in flight wears a cyan dot, everything after it stays grey.
 */
function TimelineStep({
  state,
  title,
  hint,
}: {
  state: 'done' | 'current' | 'pending';
  title: string;
  hint: string;
}) {
  const accent = state === 'done' ? MOSS : state === 'current' ? CYAN : null;
  return (
    <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%' }}>
      <Box
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          backgroundColor: accent ? `${accent}1A` : WELL,
          border: `1px solid ${accent ?? EDGE}`,
        }}
      >
        {state === 'done' ? (
          <svg width="11" height="11" viewBox="0 0 24 24">
            <path
              d="M5 12l5 5L20 7"
              fill="none"
              stroke={MOSS}
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <Box
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: state === 'current' ? CYAN : DIM,
            }}
          />
        )}
      </Box>
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: DISPLAY,
            fontSize: 12,
            fontWeight: 500,
            lineHeight: '16px',
            color: state === 'pending' ? MIST : SNOW,
          }}
        >
          {title}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{hint}</Text>
      </Stack>
    </Box>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderTop: `1px solid ${HAIRLINE}`,
        width: '100%',
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, flex: 1, minWidth: 0 }}>
        {label}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: SNOW }}>{value}</Text>
    </Box>
  );
}

/** Titled block of the form: icon in accent, caption muted. */
function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Stack
      gap={16}
      style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: MIST,
          }}
        >
          {title}
        </Text>
      </Box>
      {children}
    </Stack>
  );
}

/** A switch that owns a whole row, with the sentence it turns on beside it. */
function ToggleRow({
  checked,
  onChange,
  title,
  hint,
  titleSize = 12,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint: string;
  titleSize?: number;
}) {
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        width: '100%',
      }}
    >
      <Switch
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        style={{ flexShrink: 0 }}
      />
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: titleSize, fontWeight: 500, lineHeight: '17px', color: SNOW }}>
          {title}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{hint}</Text>
      </Stack>
    </Box>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        lineHeight: '12px',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}

function BarButton({
  children,
  primary,
  icon,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  primary?: boolean;
  icon?: 'arrow' | 'back' | 'server' | 'tick';
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 38,
        paddingInline: 16,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {icon === 'tick' && (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path
            d="M5 12l5 5L20 7"
            fill="none"
            stroke={CYAN}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {icon === 'back' && (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M19 12h-14" fill="none" stroke={MIST} strokeWidth="2.4" strokeLinecap="round" />
          <path
            d="M11 18l-6 -6l6 -6"
            fill="none"
            stroke={MIST}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {icon === 'server' && (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="7" rx="2" fill="none" stroke={CYAN} strokeWidth="2" />
          <rect x="3" y="13" width="18" height="7" rx="2" fill="none" stroke={CYAN} strokeWidth="2" />
        </svg>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '16px',
          color: primary ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
      {icon === 'arrow' && (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M5 12h14" fill="none" stroke={CYAN} strokeWidth="2.4" strokeLinecap="round" />
          <path
            d="M13 6l6 6l-6 6"
            fill="none"
            stroke={CYAN}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </UnstyledButton>
  );
}

/** Lightning bolt: the profile/inbound glyph used across the panel. */
function BoltIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M13 3l-9 10.5h7l-1 7.5l9 -10.5h-7z"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Eye: a preview of what the button is about to do. */
function EyeIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" fill="none" stroke={color} strokeWidth="1.8" />
      <path
        d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Plain tick, for the "registered" state of the page bar. */
function TickIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M5 12l5 5L20 7"
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarnIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 9v4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 17h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M10.3 4.3l-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7 -3l-8 -14a2 2 0 0 0 -3.4 0"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Key on a ring: the bootstrap secret. */
function KeyIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="15" r="4" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M10.85 12.15L19 4" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 5l2 2" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 8l2 2" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TerminalIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M7 8l4 4l-4 4"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13 16h4" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke={color} strokeWidth="1.9" />
    </svg>
  );
}

function FileIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M6 4h9l5 5v11a1 1 0 0 1 -1 1h-13a1 1 0 0 1 -1 -1v-15a1 1 0 0 1 1 -1"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 4v5h6" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="1.8" />
      <path
        d="M12 7v5l3 2"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InfoIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 9h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M11 12h1v4h1"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

/** Two stacked rack units. Same glyph the fleet cards use. */
function ServerIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="3" y="4" width="18" height="7" rx="2" fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
      <rect x="3" y="13" width="18" height="7" rx="2" fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M7 8h.01" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7 17h.01" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** Shield with a pin inside: hardening, not plain security. */
function ShieldPinIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 11m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M12 12v2.5" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
