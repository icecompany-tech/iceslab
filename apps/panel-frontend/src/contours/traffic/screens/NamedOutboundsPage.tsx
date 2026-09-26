import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage } from '@/lib/net/client';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { COUNTRY_OPTIONS, countryFlag } from '@/lib/domain/countries';
import {
  CREATABLE_OUTBOUND_TYPES,
  OUTBOUND_FINGERPRINTS,
  createNamedOutbound,
  deleteNamedOutbound,
  listNamedOutbounds,
  namedOutboundRefusal,
  updateNamedOutbound,
  type NamedOutbound,
  type NamedOutboundRefusal,
  type NamedOutboundType,
  type NamedOutboundUse,
  type OutboundSecurity,
} from '@/lib/domain/namedOutbounds';
import {
  outboundCreateBody,
  outboundFormValues,
  outboundProblems,
  outboundUpdateBody,
  type OutboundFormValues,
} from '@/contours/traffic/lib/namedOutboundForm';
import { AMBER, CARD, CYAN, DIM, DISPLAY, FAINT, HAIRLINE, MIST, MONO, RED, SNOW, WELL } from '@/contours/traffic/lib/colors';

type T = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Именованные выходы (фаза 10, BACK a045f29): чужие vless и socks серверы под
 * именем оператора. Список (имя, тип, страна, где используется), форма по
 * типу, удаление с подтверждением. Направление каскада встанет на выход после
 * второй части контракта BACK; здесь пока только каталог.
 */
export function NamedOutboundsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  usePageMeta([]);

  const listQuery = useQuery({ queryKey: ['named-outbounds'], queryFn: listNamedOutbounds });
  const outbounds = listQuery.data?.outbounds ?? [];
  // null: формы нет; 'new': новый выход; иначе правка этого.
  const [editing, setEditing] = useState<NamedOutbound | 'new' | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => deleteNamedOutbound(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['named-outbounds'] });
      notifications.show({ color: 'green', message: t('namedOutbounds.deleted') });
    },
    onError: (err) => {
      const r = namedOutboundRefusal(err);
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: r ? refusalWords(r, t) : apiErrorMessage(err),
        autoClose: 12000,
      });
      void qc.invalidateQueries({ queryKey: ['named-outbounds'] });
    },
  });

  function confirmDelete(o: NamedOutbound) {
    modals.openConfirmModal({
      title: t('namedOutbounds.deleteTitle', { name: o.name }),
      children: (
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '19px', color: SNOW }}>
          {t('namedOutbounds.deleteBody')}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(o.id),
    });
  }

  return (
    <Stack gap={20}>
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          borderRadius: 12,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Box style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <Text style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 500, color: SNOW }}>
              {t('namedOutbounds.title')}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 11, color: MIST }}>
              {listQuery.data ? t('namedOutbounds.count', { n: outbounds.length }) : ''}
            </Text>
          </Box>
          <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: FAINT }}>
            {t('namedOutbounds.intro')}
          </Text>
        </Stack>
        <GhostButton onClick={() => setEditing(editing === 'new' ? null : 'new')}>{t('namedOutbounds.add')}</GhostButton>
      </Box>

      {editing !== null && (
        <OutboundForm
          key={editing === 'new' ? 'new' : editing.id}
          stored={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}

      {listQuery.isLoading && <Placeholder title={t('common.loading')} body="" />}
      {listQuery.data && outbounds.length === 0 && (
        <Placeholder title={t('namedOutbounds.emptyTitle')} body={t('namedOutbounds.emptyBody')} />
      )}

      {outbounds.map((o) => (
        <OutboundRow key={o.id} outbound={o} onEdit={() => setEditing(o)} onDelete={() => confirmDelete(o)} />
      ))}
    </Stack>
  );
}

/** Отказ сервера одной фразой для тоста. */
function refusalWords(r: NamedOutboundRefusal, t: T): string {
  switch (r.code) {
    case 'NAME_TAKEN':
      return t('namedOutbounds.refused.nameTaken', { name: r.name });
    case 'IN_USE':
      return `${t('namedOutbounds.refused.inUse')} ${usesText(r.usedBy, t)}`;
    case 'TYPE_NOT_FOR_DIRECTION':
      return `${t('namedOutbounds.refused.typeNotForDirection', { type: r.type })} ${usesText(r.usedBy, t)}`;
    case 'VALIDATION':
      return t('namedOutbounds.refused.validation');
  }
}

function usesText(usedBy: NamedOutboundUse[], t: T): string {
  return usedBy.map((u) => t('namedOutbounds.usedBy', { cascade: u.cascadeName, tag: u.directionTag })).join(', ');
}

/** Где стоит выход: ссылки на каскады, направление номером. */
function UsedByLinks({ usedBy }: { usedBy: NamedOutboundUse[] }) {
  const { t } = useTranslation();
  if (usedBy.length === 0) {
    return <Text style={{ fontFamily: MONO, fontSize: 11, color: DIM }}>{t('namedOutbounds.notUsed')}</Text>;
  }
  return (
    <Box style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
      {usedBy.map((u) => (
        <Link
          key={`${u.cascadeId}-${u.directionTag}`}
          to={`/nodes/cascades/${u.cascadeId}`}
          style={{ fontFamily: MONO, fontSize: 11, color: CYAN, textDecoration: 'underline', textUnderlineOffset: 2 }}
        >
          {t('namedOutbounds.usedBy', { cascade: u.cascadeName, tag: u.directionTag })}
        </Link>
      ))}
    </Box>
  );
}

/** Куда ведёт выход, одной строкой: сервер, порт, защита. */
function targetWords(o: NamedOutbound): string {
  const c = o.config;
  if (o.type !== 'vless' && o.type !== 'socks') return '';
  const where = `${String(c.server ?? '')}:${String(c.port ?? '')}`;
  if (o.type === 'socks') return c.username ? `${where} · auth` : where;
  const sec = String(c.security ?? 'none');
  return c.flow ? `${where} · ${sec} · vision` : `${where} · ${sec}`;
}

function OutboundRow({ outbound, onEdit, onDelete }: { outbound: NamedOutbound; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const imported = !CREATABLE_OUTBOUND_TYPES.includes(outbound.type);
  const inUse = outbound.usedBy.length > 0;
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 16px',
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      <Text style={{ fontSize: 16, width: 22, flexShrink: 0 }}>{outbound.countryCode ? countryFlag(outbound.countryCode) : ''}</Text>
      <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: SNOW }}>{outbound.name}</Text>
          <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: MIST }}>
            {outbound.type}
          </Text>
          {imported && (
            <Text title={t('namedOutbounds.importedHint')} style={{ fontFamily: MONO, fontSize: 10, color: AMBER }}>
              {t('namedOutbounds.importedOnly')}
            </Text>
          )}
        </Box>
        <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '14px', color: FAINT }}>{targetWords(outbound)}</Text>
      </Stack>
      <Box style={{ width: 280, flexShrink: 0 }}>
        <UsedByLinks usedBy={outbound.usedBy} />
      </Box>
      <GhostButton onClick={onEdit}>{t('namedOutbounds.edit')}</GhostButton>
      {/* Занятый выход сервер удалить не даст: кнопка это говорит заранее,
          отказ сервера всё равно скажет своими словами. */}
      <GhostButton disabled={inUse} title={inUse ? t('namedOutbounds.deleteBlocked') : undefined} onClick={onDelete}>
        {t('namedOutbounds.delete')}
      </GhostButton>
    </Box>
  );
}

/** Форма по типу: общие поля, затем vless или socks. freedom и blackhole не
 *  создаются; у пришедшего импортом правятся только имя и страна. */
function OutboundForm({ stored, onDone }: { stored: NamedOutbound | null; onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [v, setV] = useState<OutboundFormValues>(() => outboundFormValues(stored));
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const set = <K extends keyof OutboundFormValues>(k: K, value: OutboundFormValues[K]) => {
    setV((prev) => ({ ...prev, [k]: value }));
    setServerErrors((prev) => {
      if (!(k in prev)) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };
  const problems = outboundProblems(v);
  const hasProblems = Object.keys(problems).length > 0;
  const errorOf = (k: keyof OutboundFormValues): string | undefined =>
    serverErrors[k] ?? (tried && problems[k] ? t(`namedOutbounds.problem.${problems[k]}`) : undefined);

  const typeOptions: NamedOutboundType[] = CREATABLE_OUTBOUND_TYPES.includes(v.type)
    ? [...CREATABLE_OUTBOUND_TYPES]
    : [...CREATABLE_OUTBOUND_TYPES, v.type];

  const save = useMutation({
    mutationFn: () =>
      stored ? updateNamedOutbound(stored.id, outboundUpdateBody(stored, v)) : createNamedOutbound(outboundCreateBody(v)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['named-outbounds'] });
      notifications.show({ color: 'green', message: t(stored ? 'namedOutbounds.saved' : 'namedOutbounds.created') });
      onDone();
    },
    onError: (err) => {
      const r = namedOutboundRefusal(err);
      if (r?.code === 'VALIDATION') {
        setServerErrors(Object.fromEntries(r.issues.map((i) => [i.field, i.message])));
      }
      if (r?.code === 'NAME_TAKEN') setServerErrors({ name: t('namedOutbounds.refused.nameTaken', { name: r.name }) });
      setRefusal(r ? refusalWords(r, t) : apiErrorMessage(err));
    },
  });

  function submit() {
    setTried(true);
    setRefusal(null);
    if (hasProblems) return;
    save.mutate();
  }

  const isVless = v.type === 'vless';
  const isSocks = v.type === 'socks';
  const secured = v.security !== 'none';

  return (
    <Stack gap={12} style={{ padding: '16px 18px', borderRadius: 12, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
      <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 500, color: SNOW }}>
        {stored ? t('namedOutbounds.editTitle', { name: stored.name }) : t('namedOutbounds.newTitle')}
      </Text>

      <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <TextInput
          style={{ width: 240 }}
          label={t('namedOutbounds.field.name')}
          description={t('namedOutbounds.field.nameHint')}
          inputWrapperOrder={['label', 'input', 'description', 'error']}
          value={v.name}
          onChange={(e) => set('name', e.currentTarget.value)}
          error={errorOf('name')}
        />
        <Stack gap={4}>
          <Label>{t('namedOutbounds.field.type')}</Label>
          <SegmentedControl
            value={v.type}
            onChange={(x) => set('type', x as NamedOutboundType)}
            data={typeOptions.map((x) => ({ value: x, label: x }))}
          />
        </Stack>
        <Select
          style={{ width: 240 }}
          label={t('namedOutbounds.field.country')}
          placeholder={t('namedOutbounds.field.countryNone')}
          data={COUNTRY_OPTIONS}
          searchable
          clearable
          value={v.countryCode || null}
          onChange={(x) => set('countryCode', x ?? '')}
        />
      </Box>

      {(isVless || isSocks) && (
        <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <TextInput
            style={{ flex: 1, minWidth: 240 }}
            label={t('namedOutbounds.field.server')}
            placeholder="de.example.com"
            value={v.server}
            onChange={(e) => set('server', e.currentTarget.value)}
            error={errorOf('server')}
          />
          <NumberInput
            style={{ width: 130 }}
            label={t('namedOutbounds.field.port')}
            min={1}
            max={65535}
            allowDecimal={false}
            allowNegative={false}
            hideControls
            value={v.port}
            onChange={(x) => set('port', typeof x === 'number' ? x : '')}
            error={errorOf('port')}
          />
          {isVless && (
            <TextInput
              style={{ flex: 1, minWidth: 320 }}
              label={t('namedOutbounds.field.uuid')}
              value={v.uuid}
              onChange={(e) => set('uuid', e.currentTarget.value)}
              error={errorOf('uuid')}
              styles={{ input: { fontFamily: MONO } }}
            />
          )}
        </Box>
      )}

      {isVless && (
        <>
          <Box style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
            <Stack gap={4}>
              <Label>{t('namedOutbounds.field.security')}</Label>
              <SegmentedControl
                value={v.security}
                onChange={(x) => set('security', x as OutboundSecurity)}
                data={['none', 'tls', 'reality'].map((x) => ({ value: x, label: x }))}
              />
            </Stack>
            <Switch
              label={t('namedOutbounds.field.vision')}
              description={t('namedOutbounds.field.visionHint')}
              checked={secured && v.vision}
              disabled={!secured}
              onChange={(e) => set('vision', e.currentTarget.checked)}
            />
          </Box>
          {secured && (
            <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <TextInput
                style={{ flex: 1, minWidth: 220 }}
                label={t('namedOutbounds.field.sni')}
                value={v.sni}
                onChange={(e) => set('sni', e.currentTarget.value)}
                error={errorOf('sni')}
              />
              <Select
                style={{ width: 180 }}
                label={t('namedOutbounds.field.fingerprint')}
                placeholder={t('namedOutbounds.field.fingerprintNone')}
                data={[...OUTBOUND_FINGERPRINTS]}
                clearable
                value={v.fingerprint || null}
                onChange={(x) => set('fingerprint', x ?? '')}
              />
              <TextInput
                style={{ width: 220 }}
                label={t('namedOutbounds.field.alpn')}
                description={t('namedOutbounds.field.alpnHint')}
                inputWrapperOrder={['label', 'input', 'description', 'error']}
                value={v.alpn}
                onChange={(e) => set('alpn', e.currentTarget.value)}
                error={errorOf('alpn')}
              />
            </Box>
          )}
          {v.security === 'reality' && (
            <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <TextInput
                style={{ flex: 1, minWidth: 380 }}
                label={t('namedOutbounds.field.realityPublicKey')}
                value={v.realityPublicKey}
                onChange={(e) => set('realityPublicKey', e.currentTarget.value)}
                error={errorOf('realityPublicKey')}
                styles={{ input: { fontFamily: MONO } }}
              />
              <TextInput
                style={{ width: 220 }}
                label={t('namedOutbounds.field.realityShortId')}
                description={t('namedOutbounds.field.realityShortIdHint')}
                inputWrapperOrder={['label', 'input', 'description', 'error']}
                value={v.realityShortId}
                onChange={(e) => set('realityShortId', e.currentTarget.value)}
                error={errorOf('realityShortId')}
                styles={{ input: { fontFamily: MONO } }}
              />
            </Box>
          )}
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: FAINT }}>
            {t('namedOutbounds.field.transportNote')}
          </Text>
        </>
      )}

      {isSocks && (
        <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <TextInput
            style={{ width: 240 }}
            label={t('namedOutbounds.field.username')}
            value={v.username}
            onChange={(e) => set('username', e.currentTarget.value)}
            error={errorOf('username')}
          />
          <PasswordInput
            style={{ width: 240 }}
            label={t('namedOutbounds.field.password')}
            value={v.password}
            onChange={(e) => set('password', e.currentTarget.value)}
            error={errorOf('password')}
          />
        </Box>
      )}

      {refusal && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: RED }}>{refusal}</Text>
      )}

      <Box style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <GhostButton onClick={onDone}>{t('common.cancel')}</GhostButton>
        <GhostButton disabled={save.isPending || (tried && hasProblems)} onClick={submit}>
          {stored ? t('namedOutbounds.save') : t('namedOutbounds.create')}
        </GhostButton>
      </Box>
    </Stack>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <Box style={{ padding: '28px 22px', borderRadius: 12, backgroundColor: CARD, border: `1px dashed ${HAIRLINE}` }}>
      <Stack gap={8}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 14, color: SNOW }}>{title}</Text>
        {body && <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '18px', color: MIST, maxWidth: 680 }}>{body}</Text>}
      </Stack>
    </Box>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: MIST }}>
      {children}
    </Text>
  );
}

/** Тихая кнопка. Своя, а не из чужого контура: линт это стережёт. */
function GhostButton({
  children,
  disabled,
  title,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{
        height: 32,
        paddingInline: 12,
        borderRadius: 8,
        border: `1px solid ${HAIRLINE}`,
        backgroundColor: CARD,
        color: disabled ? DIM : SNOW,
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        cursor: disabled ? 'default' : 'pointer',
        flexShrink: 0,
      }}
    >
      {children}
    </UnstyledButton>
  );
}
