import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconRocket, IconServer2 } from '@tabler/icons-react';
import { apiErrorMessage } from '@/lib/net/client';
import { singboxXrayMessage, singboxXrayRefusal } from '@/lib/domain/singboxXray';
import {
  createBinding,
  deleteBinding,
  getNextFreePort,
  listBindings,
  type Profile,
} from '@/lib/domain/profiles';
import { deployDiff } from '@/contours/profiles/lib/deployDiff';
import { plainDefaultPort } from '@/contours/profiles/lib/plainSubprotocol';
import { hostHiddenFacts, listHosts, type Host } from '@/lib/domain/hosts';
import { HostHiddenLine } from '@/ui/HostHiddenLine';
import { listNodes, type Node as PanelNode } from '@/lib/domain/nodes';
import { nodeStatusText } from '@/lib/domain/nodeStatusText';
import {
  engineCoreWord,
  engineListWords,
  nodeIntentWords,
  nodeRunsEngine,
  type EngineName,
} from '@/lib/domain/engines';
import { transportOf } from '@iceslab/shared';
import {
  checkNodePort,
  portRefusalOf,
  type PortCheckResult,
  type PortOwner,
  type PortTakenCode,
} from '@/lib/domain/portCheck';
import { PortCheckHint, PortRefusalLine } from '@/ui/PortCheckHint';
import { awgGenerationsKnown } from '@/lib/domain/nodeFields';
import {
  awgGateText,
  awgProfilePrediction,
  coreGateRefusal,
  nodeCoreBlocks,
  nodeCoreFit,
  nodeCoreFitText,
  type CoreGateRefusal,
} from '@/lib/domain/nodeCoreFit';
import { NodeCoreLine } from '@/ui/NodeCoreLine';
import { CoreGateRefusalLine } from '@/ui/CoreGateRefusalLine';

interface Props {
  profile: Profile | null;
  onClose: () => void;
}

export function DeployProfileModal({ profile, onClose }: Props) {
  const { t } = useTranslation();
  const opened = profile !== null;
  const qc = useQueryClient();

  const nodesQuery = useQuery({
    // F8 - distinct key. NodesPage caches ['nodes', regionFilter] and with the
    // default region that's ['nodes', 'all'] - the same key this modal used,
    // but a different queryFn shape. Namespacing avoids the two clobbering each
    // other's cache.
    queryKey: ['nodes', 'deploy-picker'],
    queryFn: () => listNodes({ limit: 100 }),
    enabled: opened,
  });

  const bindingsQuery = useQuery({
    queryKey: ['bindings', { profileId: profile?.id }],
    queryFn: () => listBindings({ profileId: profile!.id }),
    enabled: opened && profile !== null,
  });

  // Хосты профиля: только ради того, чтобы сказать под нодой, что её хост ни
  // одна подписка не выдаст (нода в каскаде не вход). Факт хоста главный, если
  // хост есть; у ноды без хоста говорит факт самой ноды (см. hostHiddenFacts).
  const hostsQuery = useQuery({
    queryKey: ['hosts', { profileId: profile?.id }],
    queryFn: () => listHosts({ profileId: profile!.id }),
    enabled: opened && profile !== null,
  });
  const hostOfNode = useMemo(() => {
    const nodeOfBinding = new Map((bindingsQuery.data?.bindings ?? []).map((b) => [b.id, b.nodeId] as const));
    const m = new Map<string, Pick<Host, 'hiddenByCascade'>>();
    for (const h of hostsQuery.data?.hosts ?? []) {
      const nodeId = nodeOfBinding.get(h.bindingId);
      if (nodeId) m.set(nodeId, h);
    }
    return m;
  }, [bindingsQuery.data, hostsQuery.data]);

  const initialSelected = useMemo(() => {
    const set = new Set<string>();
    for (const b of bindingsQuery.data?.bindings ?? []) {
      set.add(b.nodeId);
    }
    return set;
  }, [bindingsQuery.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Что было отмечено, когда окно открылось. Снимать разрешено только то, что
   *  оператор снял сам, см. `deployDiff`. */
  const [seeded, setSeeded] = useState<Set<string>>(new Set());

  // SOCKS5 / HTTP have a port people expect (1080, 3128), and that one wins
  // over the server's next-free suggestion; the per-node check below still
  // says whether it is free.
  const plainPort = plainDefaultPort(profile);
  const defaultPort = useMemo(() => {
    const cfg = profile?.config as { port?: number } | undefined;
    return plainPort ?? cfg?.port ?? 443;
  }, [profile, plainPort]);

  // Port admin chooses for NEW bindings created in this modal session.
  // Existing bindings keep their port - admin edits them inline in
  // Nodes → Edit. Initialized to the profile default on each open.
  const [port, setPort] = useState<number>(defaultPort);
  // F-P1-b: once the admin types a port, stop auto-suggesting so we don't
  // clobber their choice. Reset on each open.
  const [portTouched, setPortTouched] = useState(false);

  /**
   * Заполнение черновика при открытии, БЕЗ эффекта.
   *
   * Раньше этим занимались два эффекта, и оба зависели от данных запроса. Из-за
   * этого фоновый рефетч привязок молча возвращал набор нод к серверному, стирая
   * то, что оператор уже отметил. Здесь сидирование привязано к СОБЫТИЮ (открыли
   * модалку для такого-то профиля, данные пришли), а не к идентичности объекта,
   * поэтому повторный ответ сервера с тем же содержимым ничего не трогает.
   */
  const seedKey = opened
    ? `${profile?.id ?? ''}:${bindingsQuery.data ? 'loaded' : 'pending'}`
    : null;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (seedKey !== null && seedKey !== seededFor) {
    setSeededFor(seedKey);
    setSelected(new Set(initialSelected));
    setSeeded(new Set(initialSelected));
    setPort(defaultPort);
    setPortTouched(false);
  }

  // F-P1-b auto-free-port: when the admin picks a node that isn't deployed yet,
  // suggest the next free port on it instead of blindly reusing 443 (which
  // 409s the moment that node already runs a protocol). Skips if the admin
  // already typed their own port this session. Uses the FIRST newly-selected
  // node; a port free there may still collide on another node in a multi-select,
  // but the human-readable 409 (F-P1) covers that edge.
  const firstNewNodeId = useMemo(() => {
    for (const id of selected) if (!seeded.has(id)) return id;
    return null;
  }, [selected, seeded]);
  useEffect(() => {
    if (!opened || portTouched || firstNewNodeId === null || plainPort !== null) return;
    let cancelled = false;
    getNextFreePort(firstNewNodeId)
      .then((p) => {
        if (!cancelled) setPort(p);
      })
      .catch(() => {
        /* fall back to the current value; createBinding still guards the port */
      });
    return () => {
      cancelled = true;
    };
  }, [opened, portTouched, firstNewNodeId, plainPort]);

  /**
   * Что панель знает про этот порт на КАЖДОЙ новой ноде, отдельно.
   *
   * Порт один на все отмеченные ноды, но занят он может быть на одной и свободен
   * на другой, и сводная строка «про первую занятую» прятала остальные. Проверка
   * идёт с транспортом профиля: подсказка свободного порта с сервера
   * (next-free-port) транспорт не учитывает, и без этой строки udp-порт, занятый
   * по tcp, выглядел бы свободным, а tcp-порт, занятый по udp, занятым.
   */
  const [portChecks, setPortChecks] = useState<Map<string, PortCheckResult>>(new Map());
  const [portChecking, setPortChecking] = useState(false);
  /** Отказ сохранения по порту: код плюс держатели, в машинной форме. */
  const [portRefusal, setPortRefusal] = useState<{
    code: PortTakenCode;
    conflicts: PortOwner[];
  } | null>(null);

  /** С конфигом профиля, а не по таблице протоколов: у xray с `network: kcp`
   *  это udp, и по имени протокола этого не видно. */
  const portCheckTransport = useMemo(
    () =>
      profile
        ? transportOf(profile.protocol, profile.config as { network?: string } | null)
        : ('tcp' as const),
    [profile],
  );

  // Ноды, которые ДОБАВЛЯЮТСЯ: у уже развёрнутых порт свой и этим полем не
  // меняется, а «занято вами же» это не ответ.
  // Ключ строкой, а массив из него: так массив меняется только когда меняется
  // состав, и проверка не уходит по кругу на каждый рендер.
  const targetsKey = [...selected].filter((id) => !seeded.has(id)).sort().join(',');
  const newTargets = useMemo(() => (targetsKey ? targetsKey.split(',') : []), [targetsKey]);

  const runPortCheck = useCallback(async () => {
    if (newTargets.length === 0) {
      setPortChecks(new Map());
      return;
    }
    setPortChecking(true);
    try {
      const all = await Promise.all(
        newTargets.map(async (id) => [id, await checkNodePort(id, { port, transport: portCheckTransport })] as const),
      );
      setPortChecks(new Map(all));
    } catch {
      setPortChecks(new Map());
    } finally {
      setPortChecking(false);
    }
  }, [newTargets, port, portCheckTransport]);

  // Проверка сама, а не по уходу фокуса с поля: порт меняет и подсказка сервера,
  // и галка у новой ноды, а в обоих случаях фокус на поле не бывал.
  useEffect(() => {
    if (!opened) return;
    const timer = window.setTimeout(() => void runPortCheck(), 350);
    return () => window.clearTimeout(timer);
  }, [opened, runPortCheck]);

  /** Отказ гейта ядра (409 CORE_NOT_ON_NODE / CORE_VERSION_REFUSED) по имени ноды. */
  const [coreRefusal, setCoreRefusal] = useState<CoreGateRefusal | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profile) return;
      setCoreRefusal(null);
      // Поштучно: POST на новую галку, DELETE на снятую. Снимается только то,
      // что оператор снял сам (`deployDiff`).
      const { create: toCreate, remove: toDelete } = deployDiff(
        seeded,
        selected,
        bindingsQuery.data?.bindings ?? [],
      );

      await Promise.all([
        ...toCreate.map((nodeId) =>
          createBinding({
            profileId: profile.id,
            nodeId,
            port,
          }),
        ),
        ...toDelete.map((id) => deleteBinding(id)),
      ]);

      return { created: toCreate.length, deleted: toDelete.length };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['bindings'] });
      qc.invalidateQueries({ queryKey: ['profiles'] });
      const c = result?.created ?? 0;
      const d = result?.deleted ?? 0;
      if (c === 0 && d === 0) {
        notifications.show({ color: 'gray', message: t('profiles.deploy.noChanges') });
      } else {
        notifications.show({
          color: 'green',
          message: t('profiles.deploy.saved', { added: c, removed: d }),
        });
      }
      onClose();
    },
    onError: (err) => {
      /**
       * Порт занят на одной из выбранных нод.
       *
       * Строкой у поля порта, а не тостом: тост уезжает, а менять надо именно
       * это поле. Слова те же, что у подсказки, потому что событие то же.
       */
      const refusal = portRefusalOf(err);
      if (refusal) {
        setPortRefusal(refusal);
        // Подсказка отвечала «свободен» до сохранения, а сервер ответил
        // обратное: держать обе строки значит спорить с самим собой.
        setPortChecks(new Map());
        return;
      }
      // Ядра нет или версия отклонена: строкой под той нодой, которую назвал
      // сервер, с его командой. Ноды с таким именем в окне нет: тостом.
      const core = coreGateRefusal(err);
      if (core && nodes.some((n) => n.name === core.nodeName)) {
        setCoreRefusal(core);
        return;
      }
      // A profile saved on sing-box before the form locked its tile: the node
      // would not render it, and the binding is refused naming the field.
      const sb = singboxXrayRefusal(err);
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: sb ? singboxXrayMessage(sb, t) : apiErrorMessage(err),
      });
    },
  });

  function toggle(nodeId: string) {
    // Отказ был про прежний набор нод.
    setCoreRefusal(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  const nodes = nodesQuery.data?.nodes ?? [];
  // Знает ли сервер cores[].awgGenerations: без этого агента не судим.
  const genKnown = awgGenerationsKnown(nodesQuery.data);
  // Против того, что было при открытии, а не против живого ответа сервера:
  // привязка, появившаяся где-то ещё, правкой оператора не считается.
  const dirty = useMemo(() => {
    if (selected.size !== seeded.size) return true;
    for (const id of selected) if (!seeded.has(id)) return true;
    return false;
  }, [selected, seeded]);

  const loading = nodesQuery.isLoading || bindingsQuery.isLoading;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconRocket size={18} />
          <Text fw={600}>{t('profiles.deploy.title', { name: profile?.name ?? '' })}</Text>
        </Group>
      }
      size="lg"
    >
      <Stack>
        <Alert color="blue" variant="light">
          {t('profiles.deploy.hint', { port })}
        </Alert>

        {/* Port input for new bindings created here. Existing bindings
            keep their old port; to change an existing binding's port,
            admin goes to Nodes → Edit → inline edit in the Bindings
            list. Per AmneziaWG upstream: prefer <= 9999 ports (some
            ISPs block high UDP), avoid 51820 (well-known WG default
            targeted by DPI). */}
        <NumberInput
          label={t('profiles.deploy.port')}
          description={
            profile?.protocol === 'amneziawg'
              ? t('profileForm.deployHintAwgPort')
              : plainPort !== null
                ? t('profiles.deploy.portPlainHint', { port: plainPort })
                : t('profiles.deploy.portAutoHint')
          }
          min={1}
          max={65535}
          value={port}
          onChange={(v) => {
            setPortTouched(true);
            setPort(typeof v === 'number' ? v : Number(v) || defaultPort);
            // Старый ответ относится к старому числу, держать его на экране
            // значит отвечать не про тот порт. Отказ сервера тем более.
            setPortChecks(new Map());
            setPortRefusal(null);
          }}
        />
        {/* Отказ сервера выше подсказки: он про то же поле, но он уже
            случился, а подсказка только предполагала. */}
        {portRefusal && <PortRefusalLine code={portRefusal.code} conflicts={portRefusal.conflicts} />}
        {/* Ответ по КАЖДОЙ новой ноде отдельно: порт один, а занят он может быть
            на одной и свободен на другой. Запрета нет, отказ по факту даёт
            сохранение. */}
        {newTargets.map((nodeId) => (
          <Stack key={nodeId} gap={2}>
            <Text size="xs" c="dimmed" ff="monospace">
              {nodes.find((n) => n.id === nodeId)?.name ?? nodeId}
            </Text>
            <PortCheckHint
              result={portChecks.get(nodeId) ?? null}
              checking={portChecking}
              port={port}
              transport={portCheckTransport}
            />
          </Stack>
        ))}

        {loading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        ) : nodes.length === 0 ? (
          <Text c="dimmed" ta="center" py="md">
            {t('profiles.deploy.noNodes')}
          </Text>
        ) : (
          <Stack gap="xs">
            {nodes.map((node) => {
              const fit = profile ? nodeCoreFit(node, profile.effectiveEngine) : null;
              const checked = selected.has(node.id);
              // Профиль 3.1: модуль 1.x или агент без 3.1 откажут на сервере,
              // сказано до сохранения по факту ноды (a4ad8bc).
              const awgBlock = awgProfilePrediction(profile ?? undefined, node, genKnown);
              const awgWhy = awgBlock ? awgGateText(awgBlock, t) : null;
              return (
                <Stack key={node.id} gap={4}>
                  <NodeRow
                    node={node}
                    wanted={profile?.effectiveEngine ?? null}
                    checked={checked}
                    // No core, or a version the panel refuses: the save would be
                    // refused (CORE_NOT_ON_NODE / CORE_VERSION_REFUSED), so the
                    // tick is not offered. One already there can be taken off.
                    blockedWhy={
                      checked
                        ? null
                        : fit && nodeCoreBlocks(fit)
                          ? nodeCoreFitText(fit, t).blockWhy
                          : awgWhy
                    }
                    onToggle={() => toggle(node.id)}
                  />
                  {fit && <NodeCoreLine fit={fit} nodeId={node.id} compact />}
                  {awgWhy && coreRefusal?.nodeName !== node.name && (
                    <Text size="xs" c="red" style={{ lineHeight: '15px' }}>
                      {awgWhy}
                    </Text>
                  )}
                  {coreRefusal?.nodeName === node.name && (
                    <CoreGateRefusalLine refusal={coreRefusal} nodeId={node.id} arch={node.cores?.arch} />
                  )}
                  {/* Нода в каскаде не вход: хост профиля на ней подписка не
                      отдаст. Под именем ноды, и у ноды без хоста тоже: до
                      развёртывания это дешевле всего узнать. */}
                  <HostHiddenLine
                    facts={hostHiddenFacts(hostOfNode.get(node.id), node.name, node)}
                    compact
                  />
                </Stack>
              );
            })}
          </Stack>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saveMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            disabled={!dirty || loading}
            leftSection={<IconRocket size={14} />}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function NodeRow({
  node,
  wanted,
  checked,
  blockedWhy,
  onToggle,
}: {
  node: PanelNode;
  /** The engine that will actually render this profile, resolved by the server.
   *  Null only while the profile itself has not loaded. */
  wanted: EngineName | null;
  checked: boolean;
  /** Why the tick is not offered (nodeCoreFit), or null when it is. */
  blockedWhy: string | null;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const statusColor =
    node.status === 'online' ? 'teal' : node.status === 'disabled' ? 'gray' : 'red';
  /**
   * Will a core on this node render this profile: membership of the profile's
   * effective engine in the engines the node REPORTED.
   *
   * Three answers, and the third is the one this row used to get wrong. It
   * compared `node.protocol` with the profile's protocol, which reads a LABEL
   * as a restriction: `protocol` says which adapter was installed as primary,
   * and a node labelled `tuic` serves an xray profile beside it every day. The
   * backend measured that same reading as a gate on 2026-09-11 and it refused
   * 23 legitimate pairs.
   *
   * undefined = the node has never reported its cores, so nothing is claimed:
   * no warning, no reassurance, no colour. Today that is the whole fleet.
   */
  const runs = wanted ? nodeRunsEngine(node, wanted) : undefined;
  const willNotRun = runs === false;
  // Отчёта нет: ядра, на которые нода настроена, а не метка «протокол ноды».
  // Метка остаётся только у сервера старше `intendedEngines`.
  const intent = nodeIntentWords(node, t);
  const blocked = blockedWhy !== null;
  return (
    <Paper
      withBorder
      p="sm"
      radius="sm"
      title={blockedWhy ?? undefined}
      style={{
        cursor: blocked ? 'not-allowed' : 'pointer',
        opacity: blocked ? 0.6 : 1,
        borderColor: willNotRun ? 'var(--mantine-color-yellow-6)' : undefined,
      }}
      onClick={blocked ? undefined : onToggle}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Checkbox checked={checked} disabled={blocked} onChange={onToggle} tabIndex={-1} />
          <IconServer2 size={16} />
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="sm" fw={500} truncate>
              {node.name}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace" truncate>
              {node.address}
            </Text>
          </Stack>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {node.countryCode && (
            <Badge variant="light" size="sm">
              {node.countryCode}
            </Badge>
          )}
          {/* The badge answers one question: will this node run this profile.
              While the node has never reported its cores there is no answer, so
              the row shows the label it does have, greyed, and says in the
              tooltip that this is a label rather than a capability. */}
          <Tooltip
            label={
              runs === undefined
                ? intent
                  ? t('profileForm.nodeEnginesIntended')
                  : t('profileForm.nodeEnginesUnknown', { protocol: node.protocol })
                : willNotRun
                  ? t('profileForm.nodeWillNotRun', {
                      wanted: wanted ? engineCoreWord(wanted, t) : '',
                      engines: engineListWords(node, t),
                    })
                  : t('profileForm.nodeWillRun', {
                      wanted: wanted ? engineCoreWord(wanted, t) : '',
                    })
            }
            multiline
            w={300}
          >
            <Badge
              variant={willNotRun ? 'filled' : 'light'}
              color={willNotRun ? 'yellow' : runs === true ? 'cyan' : 'gray'}
              size="sm"
              tt="uppercase"
            >
              {willNotRun
                ? `⚠ ${engineListWords(node, t)}`
                : runs === true
                  ? engineListWords(node, t)
                  : (intent ?? node.protocol)}
            </Badge>
          </Tooltip>
          <Tooltip label={nodeStatusText(node.lastStatusMessage, t) ?? node.status}>
            <Badge variant="dot" color={statusColor} size="sm">
              {node.status}
            </Badge>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}
