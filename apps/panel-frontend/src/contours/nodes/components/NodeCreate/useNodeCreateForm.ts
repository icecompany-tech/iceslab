import { DEFAULT_NODE_PORT, SINGBOX_ENGINE_CAPABLE } from '@/contours/nodes/lib/nodeProtocols';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createBinding, listProfiles, type Profile } from '@/lib/domain/profiles';
import {
  createNode,
  findNode,
  listNodes,
  type NodeWithPayload,
} from '@/lib/domain/nodes';
import {
  createCoreVersions,
  enginesPayload,
  legacyEngines,
  nodeEnginesRefusal,
  pickFreePort,
  type FormValues,
  type NodeEnginesRefusal,
  type Registered,
} from '@/contours/nodes/lib/nodeCreateForm';
import { coreVersionRefusal } from '@/lib/domain/coreVersions';
import { apiErrorMessage } from '@/lib/net/client';
import { buildHardening } from '@/contours/nodes/lib/nodeInstall';
import { nodeFieldKnown } from '@/lib/domain/nodeFields';
import { installIntentLabel, nodeIntentWords } from '@/lib/domain/engines';

/**
 * Everything the create wizard owns that is not markup: the form, the profile
 * and node queries, the selection state and the register call that turns all of
 * it into a node plus its one-time payload. The page keeps only layout.
 */
export function useNodeCreateForm() {
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
      engines: ['xray'],
      hardenUfw: false,
      hardenFail2ban: false,
      hardenRealisticFallback: false,
      hardenSshAllowlist: [],
      coreVersions: {},
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
  /**
   * Нода вышла на связь. Флаг ЗАПОМИНАЕТ этот факт, потому что им же и
   * выключается опрос: без него запрос, перестав опрашивать, снова стал бы
   * разрешённым.
   *
   * Ставится сравнением в рендере, а не эффектом. Эффект приезжал ПОСЛЕ
   * отрисовки, и между ответом «online» и поднятым флагом оставался кадр, в
   * котором экран всё ещё говорил «ждём агента», уже получив обратное.
   */
  const [isOnline, setIsOnline] = useState(false);
  const nodeWatch = useQuery({
    queryKey: ['node', 'watch', registeredId],
    queryFn: () => findNode(registeredId!),
    enabled: step === 2 && registeredId !== null && !isOnline,
    refetchInterval: 5000,
  });
  if (!isOnline && nodeWatch.data?.status === 'online') setIsOnline(true);

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

  /**
   * Знает ли сервер поля `coreVersions`, `intendedEngines`.
   * Сперва по `fields` конверта: сервер сам говорит, что отдаёт, и это
   * работает на пустом парке (E29: после удаления всех нод мастер показал
   * старую форму). По стоящим нодам только у сервера старше `fields`
   * (nodeFieldKnown). Не знаем: прежняя форма, а не выбор, который сервер
   * может отвергнуть.
   */
  const fleetQuery = useQuery({ queryKey: ['nodes', 'all'], queryFn: () => listNodes({ limit: 100 }) });
  const coreVersionsKnown = nodeFieldKnown(fleetQuery.data, 'coreVersions');
  /** Строки отказа 400 CORE_VERSION_NOT_LISTED после «Зарегистрировать». */
  const [coreRefusal, setCoreRefusal] = useState<string[] | null>(null);
  /**
   * Знает ли сервер `intendedEngines` (64d7078), тем же способом. Знает: чипы
   * ядер; нет: прежние селект протокола и переключатель sing-box, чтобы экран
   * не слал ключ, который сервер отвергнет.
   */
  const enginesKnown = nodeFieldKnown(fleetQuery.data, 'intendedEngines');
  /** Отказ 400 INVALID_ENGINES или LAST_CORE: под чипами. */
  const [enginesRefusal, setEnginesRefusal] = useState<NodeEnginesRefusal | null>(null);
  // Какие ядра встанут на ноду: чипы, или то же из старой формы.
  const engines = enginesKnown
    ? form.values.engines
    : legacyEngines(
        form.values.protocol,
        SINGBOX_ENGINE_CAPABLE.includes(form.values.protocol) && form.values.singboxEngine,
      );
  // Что встанет на машину, словами: ядра, или у сервера старше пара протокола.
  const installWords = enginesKnown
    ? (nodeIntentWords({ intendedEngines: engines }, t) ?? '')
    : installIntentLabel(form.values, t);

  // A host can land here only if one of the engines this node will carry runs
  // the profile: its effective engine, resolved by the server, among them.
  // Everything else is listed with the reason it cannot, rather than hidden,
  // so the operator sees the whole inventory and why it is short.
  const enginesKey = engines.join(',');
  const groups = useMemo(() => {
    const all = profilesQuery.data?.profiles ?? [];
    const carried = new Set(enginesKey.split(','));
    const can: Profile[] = [];
    const cannot: { profile: Profile; reason: string }[] = [];
    for (const p of all) {
      if (carried.has(p.effectiveEngine)) {
        can.push(p);
      } else {
        cannot.push({
          profile: p,
          reason:
            p.effectiveEngine === 'singbox'
              ? t('nodeCreate.reasonNoSingbox')
              : t('nodeCreate.reasonNoCore', { protocol: p.protocol }),
        });
      }
    }
    return { can, cannot };
  }, [profilesQuery.data, enginesKey, t]);

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
      const coreVersions = createCoreVersions(coreVersionsKnown, form.values.coreVersions);
      const node: NodeWithPayload = await createNode({
        name: form.values.name.trim(),
        address: `${form.values.host.trim()}:${port}`,
        countryCode: form.values.countryCode || null,
        consumptionMultiplier:
          form.values.consumptionMultiplier === '' ? 1 : Number(form.values.consumptionMultiplier),
        domain: form.values.domain.trim() || null,
        hardening: buildHardening(form.values),
        // Ядра: intendedEngines с меткой в паре, или прежние поля у сервера
        // старше контракта.
        ...enginesPayload(enginesKnown, engines, form.values.protocol),
        // Только выбранное оператором и только если сервер поле знает.
        // Версии ядер: только выбранные компоненты; ничего не выбрано = ключа
        // нет, и сервер ставит пины.
        ...(coreVersions ? { coreVersions } : {}),
      });
      setCoreRefusal(null);
      setEnginesRefusal(null);

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
      // Версия не из манифеста: строки сервера встают в блок «Версии ядер»
      // на шаге параметров, туда же возвращаем оператора.
      const coreLines = coreVersionRefusal(err);
      setCoreRefusal(coreLines);
      // Отказ по ядрам: под чипами с кодом и полем, туда же назад. Чипов нет
      // (сервер старше поля): фраза сервера в тосте.
      const enginesBad = nodeEnginesRefusal(err);
      setEnginesRefusal(enginesBad);
      if (coreLines || enginesBad) setStep(0);
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: coreLines
          ? t('nodeEdit.coreVer.refused')
          : enginesBad
            ? enginesKnown
              ? t('nodes.form.enginesRefused')
              : t('nodes.form.enginesRefusedToast', { ...enginesBad })
            : apiErrorMessage(err),
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

  return {
    navigate,
    form,
    step,
    setStep,
    selected,
    groupOpen,
    setGroupOpen,
    registered,
    creating,
    showPayload,
    setShowPayload,
    copied,
    registeredId,
    isOnline,
    waited,
    profilesQuery,
    coreVersionsKnown,
    coreRefusal,
    enginesKnown,
    engines,
    installWords,
    enginesRefusal,
    setEnginesRefusal,
    groups,
    portByProfile,
    toggle,
    toggleAllCan,
    goNext,
    register,
    copy,
    downloadPayload,
  };
}
