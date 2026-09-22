import { useState } from 'react';
import { DEFAULT_FORMAT_NAMES } from '@iceslab/shared';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, Textarea, TextInput, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SettingsTabs } from '@/contours/subscription/components/SettingsTabs';
import { formatLabel } from '@/lib/domain/formats';
import { apiErrorMessage } from '@/lib/net/client';
import {
  getSettings,
  getSubscriptionPreviewUrl,
  probeSubscriptionAddress,
  updateSettings,
  type AdminSettings,
  type DeadTextState,
  type DeadTexts,
  type SubscriptionFormat,
  type SubscriptionLinkShape,
} from '@/lib/domain/settings';
import { AMBER, CARD, CYAN, FAINT, GROUND, HAIRLINE, MIST, MOSS, RED, SNOW, WELL } from '@/contours/subscription/lib/colors';

/**
 * Что получает человек, открывший ссылку подписки, и в каком виде.
 *
 * Один черновик и одна кнопка «Сохранить», как на соседней вкладке: страница с
 * четырьмя отдельными сохранениями оставляла оператора с половиной правки и без
 * способа понять, какой именно.
 *
 * PUT уходит ровно с четырьмя полями, которые экран редактирует. Префикс пути и
 * счётчик подписок он ПОКАЗЫВАЕТ, но не шлёт: предлагать серверу принять то,
 * чего человек не менял, это способ однажды стереть чужое значение.
 */

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/**
 * Форматы, которые принимает настройка «по умолчанию», из контракта.
 *
 * ⚠ Свой список здесь держал пять имён из десяти: `json`, `xkeen`, `surge`,
 * `quantumultx` и `loon` выбрать было нельзя, хотя сервер их принимает. Порядок
 * теперь контрактный, а не «из макета»: макет пережил бы добавление формата
 * молча, а список из контракта нет.
 */
const FORMATS: readonly SubscriptionFormat[] = DEFAULT_FORMAT_NAMES;

const DEAD_STATES: { key: DeadTextState; tone: string }[] = [
  { key: 'expired', tone: RED },
  { key: 'limited', tone: AMBER },
  { key: 'disabled', tone: MIST },
];

const PREVIEW_STATES = ['active', 'expiring', 'expired', 'limited', 'disabled'] as const;
type PreviewState = (typeof PREVIEW_STATES)[number];

interface Draft {
  format: SubscriptionFormat;
  shape: SubscriptionLinkShape;
  publicHost: string;
  dead: DeadTexts;
}

function toDraft(s: AdminSettings): Draft {
  return {
    format: s.subscriptionDefaultFormat ?? 'plain',
    shape: s.subscriptionLinkShape ?? 'per-exit',
    publicHost: s.subscriptionPublicHost ?? '',
    dead: s.subscriptionDeadTexts ?? {},
  };
}

/** Пустое поле означает «оставить наш текст», а не «показать пустую строку»,
 *  поэтому пустые ветки не доезжают до сервера вовсе. */
function cleanDead(d: DeadTexts): DeadTexts | null {
  const out: DeadTexts = {};
  for (const { key } of DEAD_STATES) {
    const ru = d[key]?.ru?.trim();
    const en = d[key]?.en?.trim();
    if (ru || en) out[key] = { ...(ru ? { ru } : {}), ...(en ? { en } : {}) };
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function SubscriptionDeliveryPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings', 'all'], queryFn: getSettings });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lang, setLang] = useState<'ru' | 'en'>('ru');
  const [previewState, setPreviewState] = useState<PreviewState>('active');

  // Сеять один раз. Повторный посев на каждом refetch выбросил бы начатую правку.
  if (!loaded && settingsQuery.data) {
    setLoaded(true);
    setDraft(toDraft(settingsQuery.data));
  }

  const saved = settingsQuery.data ? toDraft(settingsQuery.data) : null;
  const dirty = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));
  const hostChanged = Boolean(draft && saved && draft.publicHost.trim() !== saved.publicHost.trim());

  const probe = useMutation({
    mutationFn: probeSubscriptionAddress,
    onError: (err) =>
      notifications.show({ color: 'red', title: t('deliverySetup.probeFailed'), message: apiErrorMessage(err) }),
  });

  /**
   * Предпросмотр на языке, которым пользуется оператор.
   *
   * Язык входит в ключ кэша: смена языка панели должна давать новую ссылку, а
   * не показывать прежнюю страницу на прежнем языке. Тексты неактивной
   * подписки правятся на двух языках, и увидеть надо тот, который правят.
   */
  const previewLang = i18n.language.startsWith('ru') ? 'ru' : 'en';
  const previewQuery = useQuery({
    queryKey: ['subscription-preview', previewState, previewLang],
    queryFn: () => getSubscriptionPreviewUrl(previewState, previewLang),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('nothing to save');
      return updateSettings({
        subscriptionDefaultFormat: draft.format,
        subscriptionLinkShape: draft.shape,
        subscriptionPublicHost: draft.publicHost.trim() || null,
        subscriptionDeadTexts: cleanDead(draft.dead),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await qc.invalidateQueries({ queryKey: ['subscription-preview'] });
      setLoaded(false);
      notifications.show({ color: 'green', message: t('deliverySetup.saved') });
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) }),
  });

  if (!draft) {
    return (
      <Box style={{ padding: 40, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: MIST, textAlign: 'center' }}>
          {t('common.loading')}
        </Text>
      </Box>
    );
  }

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const s = settingsQuery.data;
  const activeCount = s?.subscriptionActiveCount ?? 0;

  return (
    <Stack gap={20}>
      <Box className="page-bar">
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 16, flexShrink: 0 }}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {t('deliverySetup.title')}
          </Text>
        </Box>
        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />
        <Box className="page-bar-facts">
          <Text className="page-bar-fact-soft" style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}>
            {t('deliverySetup.subtitle')}
          </Text>
          <Box style={{ flex: 1, minWidth: 0 }} />
        </Box>

        {/* Кнопки живут в `page-bar-actions`, а не в строке фактов: на узком
            экране складывается именно этот блок, а из строки фактов они бы
            торчали за край. */}
        <Box className="page-bar-actions">
          <BarButton onClick={() => setLoaded(false)} disabled={!dirty}>
            {t('common.cancel')}
          </BarButton>
          <BarButton strong onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? t('deliverySetup.saving') : t('common.save')}
          </BarButton>
        </Box>
      </Box>

      <SettingsTabs dirty={dirty} />

      {/* Те же классы, что у соседней вкладки: колонки живут в css, потому что
          свои inline-стили не умеют сложить их на узком экране. */}
      <Box className="page-columns page-columns--tight">
        <Stack gap={20} style={{ flex: 1, minWidth: 0, width: '100%' }}>
          {/* ФОРМАТ ПО УМОЛЧАНИЮ */}
          <Section title={t('deliverySetup.formatTitle')} hint={t('deliverySetup.formatHint')}>
            <Box
              style={{
                display: 'inline-flex',
                flexWrap: 'wrap',
                gap: 4,
                padding: 4,
                borderRadius: 9,
                backgroundColor: GROUND,
                border: `1px solid ${HAIRLINE}`,
                width: 'fit-content',
              }}
            >
              {FORMATS.map((f) => (
                <UnstyledButton
                  key={f}
                  type="button"
                  onClick={() => patch({ format: f })}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 6,
                    backgroundColor: draft.format === f ? CYAN : 'transparent',
                    fontFamily: MONO,
                    fontSize: 11,
                    lineHeight: '14px',
                    color: draft.format === f ? '#08101A' : MIST,
                  }}
                >
                  {formatLabel(f, t)}
                </UnstyledButton>
              ))}
            </Box>
          </Section>

          {/* ФОРМА ВЫДАЧИ */}
          <Section title={t('deliverySetup.shapeTitle')} hint={t('deliverySetup.shapeHint')}>
            {/* Два варианта встают друг под друга, когда на строку им не
                хватает: сжатые до трети экрана столбцы режут образец ссылки
                посередине, а он и есть то, что тут сравнивают. */}
            <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 14, width: '100%' }}>
              <ShapeChoice
                on={draft.shape === 'per-node'}
                onClick={() => patch({ shape: 'per-node' })}
                label={t('deliverySetup.shapePerNode')}
                lines={['nls-exit-2', 'fi-relay-1', 'msk-entry-1']}
                note={t('deliverySetup.shapePerNodeNote')}
              />
              <ShapeChoice
                on={draft.shape === 'per-exit'}
                onClick={() => patch({ shape: 'per-exit' })}
                label={t('deliverySetup.shapePerExit')}
                lines={['nls-exit-2 · VLESS', 'nls-exit-2 · Hysteria2', 'fi-relay-1 · MTProto']}
                note={t('deliverySetup.shapePerExitNote')}
              />
            </Box>
          </Section>

          {/* ТЕКСТЫ НЕАКТИВНОЙ ПОДПИСКИ */}
          <Section title={t('deliverySetup.deadTitle')} hint={t('deliverySetup.deadHint')}>
            <Stack gap={12}>
              {DEAD_STATES.map(({ key, tone }) => (
                <Stack key={key} gap={6}>
                  <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Box style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: tone, flexShrink: 0 }} />
                    <Text
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: MIST,
                      }}
                    >
                      {t(`deliverySetup.dead.${key}`)}
                    </Text>
                    <Box style={{ flex: 1 }} />
                    {/* Один переключатель языка на все три поля: языки правят
                        парами, и три отдельных тумблера значили бы три места,
                        где можно забыть переключиться. */}
                    <LangToggle value={lang} onChange={setLang} />
                  </Box>
                  <Textarea
                    autosize
                    minRows={2}
                    maxRows={5}
                    value={draft.dead[key]?.[lang] ?? ''}
                    placeholder={t(`deliverySetup.deadDefault.${key}`)}
                    onChange={(e) =>
                      patch({
                        dead: {
                          ...draft.dead,
                          [key]: { ...draft.dead[key], [lang]: e.currentTarget.value },
                        },
                      })
                    }
                    styles={{
                      input: {
                        backgroundColor: WELL,
                        border: `1px solid ${HAIRLINE}`,
                        color: SNOW,
                        fontFamily: DISPLAY,
                        fontSize: 13,
                        lineHeight: '19px',
                      },
                    }}
                  />
                </Stack>
              ))}
            </Stack>
          </Section>

          {/* АДРЕС ВЫДАЧИ */}
          <Section title={t('deliverySetup.addressTitle')} hint={t('deliverySetup.addressHint')}>
            {/* Ряд переносится, а не ужимается: на телефоне поле с `minWidth: 0`
                схлопывалось до нуля, и две подписи ложились одна на другую. */}
            <Box
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
                gap: 12,
                width: '100%',
              }}
            >
              <Stack gap={6} style={{ flex: '1 1 240px', minWidth: 0 }}>
                <FieldLabel>{t('deliverySetup.publicHost')}</FieldLabel>
                <TextInput
                  value={draft.publicHost}
                  placeholder="sub.example.com"
                  onChange={(e) => patch({ publicHost: e.currentTarget.value })}
                  styles={{
                    input: {
                      backgroundColor: WELL,
                      border: `1px solid ${HAIRLINE}`,
                      color: SNOW,
                      fontFamily: MONO,
                      fontSize: 12,
                    },
                  }}
                />
              </Stack>
              <Stack gap={6} style={{ flex: '0 1 200px', minWidth: 160 }}>
                <FieldLabel>{t('deliverySetup.pathPrefix')}</FieldLabel>
                <Box
                  style={{
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 12px',
                    borderRadius: 8,
                    backgroundColor: GROUND,
                    border: `1px solid ${HAIRLINE}`,
                  }}
                >
                  <Text style={{ fontFamily: MONO, fontSize: 12, color: MIST }}>
                    {s?.subscriptionPathPrefix ?? '/sub'}
                  </Text>
                </Box>
                <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: MIST }}>
                  {t('deliverySetup.pathPrefixWhy')}
                </Text>
              </Stack>
              <Box style={{ paddingTop: 22, flexShrink: 0 }}>
                <BarButton onClick={() => probe.mutate()} disabled={probe.isPending}>
                  {probe.isPending ? t('deliverySetup.probing') : t('deliverySetup.probe')}
                </BarButton>
              </Box>
            </Box>

            {/* Число выдано ДО сохранения, а не после: каждый из этих людей
                держит ссылку на старом хосте, и никакой редирект их не спасёт,
                потому что старое имя может вообще перестать резолвиться в нас. */}
            {hostChanged && activeCount > 0 && (
              <Box
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '12px 14px',
                  borderRadius: 10,
                  backgroundColor: `${AMBER}0F`,
                  border: `1px solid ${AMBER}33`,
                }}
              >
                <Text style={{ fontFamily: MONO, fontSize: 13, color: AMBER, flexShrink: 0 }}>
                  {activeCount}
                </Text>
                <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: AMBER }}>
                  {t('deliverySetup.activeCountWarn')}
                </Text>
              </Box>
            )}

            {probe.data && <ProbeResult r={probe.data} />}
          </Section>
        </Stack>

        {/* ПРЕДПРОСМОТР. Ширину задаёт `page-rail`, а не это место: своя цифра
            держалась бы и там, где колонка уже сложилась под форму. */}
        <Box className="page-rail">
          <Box
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 20,
              borderRadius: 10,
              backgroundColor: CARD,
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Caption>{t('deliverySetup.previewTitle')}</Caption>
              <Box style={{ flex: 1 }} />
            </Box>

            <Box style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {PREVIEW_STATES.map((st) => (
                <UnstyledButton
                  key={st}
                  type="button"
                  onClick={() => setPreviewState(st)}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 999,
                    backgroundColor: previewState === st ? `${CYAN}1A` : 'transparent',
                    border: `1px solid ${previewState === st ? `${CYAN}55` : HAIRLINE}`,
                    fontFamily: MONO,
                    fontSize: 10,
                    color: previewState === st ? CYAN : MIST,
                  }}
                >
                  {t(`deliverySetup.previewState.${st}`)}
                </UnstyledButton>
              ))}
            </Box>

            <Box
              style={{
                height: 520,
                borderRadius: 10,
                overflow: 'hidden',
                backgroundColor: GROUND,
                border: `1px solid ${HAIRLINE}`,
              }}
            >
              {previewQuery.data?.url ? (
                <iframe
                  key={previewQuery.data.url}
                  src={previewQuery.data.url}
                  title={t('deliverySetup.previewTitle')}
                  style={{ width: '100%', height: '100%', border: 0 }}
                />
              ) : (
                <Box style={{ padding: 20 }}>
                  <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: MIST }}>
                    {t('common.loading')}
                  </Text>
                </Box>
              )}
            </Box>

            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: FAINT }}>
              {t('deliverySetup.previewHint')}
            </Text>

            {previewQuery.data?.url && (
              <UnstyledButton
                component="a"
                href={previewQuery.data.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  backgroundColor: WELL,
                  border: `1px solid ${HAIRLINE}`,
                  fontFamily: DISPLAY,
                  fontSize: 12,
                  color: MIST,
                }}
              >
                {t('deliverySetup.previewOpen')}
              </UnstyledButton>
            )}
          </Box>
        </Box>
      </Box>
    </Stack>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <Stack
      gap={14}
      style={{ padding: '20px 22px', borderRadius: 12, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
    >
      <Stack gap={4}>
        <Caption>{title}</Caption>
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '16px', color: MIST }}>{hint}</Text>
      </Stack>
      {children}
    </Stack>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: FAINT,
      }}
    >
      {children}
    </Text>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: FAINT,
      }}
    >
      {children}
    </Text>
  );
}

function BarButton({
  children,
  onClick,
  disabled,
  strong,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  strong?: boolean;
}) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 34,
        padding: '0 14px',
        borderRadius: 8,
        backgroundColor: strong ? `${CYAN}1A` : WELL,
        border: `1px solid ${strong ? `${CYAN}55` : HAIRLINE}`,
        fontFamily: DISPLAY,
        fontSize: 12,
        color: strong ? CYAN : MIST,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        flexShrink: 0,
      }}
    >
      {children}
    </UnstyledButton>
  );
}

function LangToggle({ value, onChange }: { value: 'ru' | 'en'; onChange: (v: 'ru' | 'en') => void }) {
  return (
    <Box style={{ display: 'flex', gap: 2 }}>
      {(['ru', 'en'] as const).map((l) => (
        <UnstyledButton
          key={l}
          type="button"
          onClick={() => onChange(l)}
          style={{
            padding: '2px 7px',
            borderRadius: 5,
            backgroundColor: value === l ? `${CYAN}1A` : 'transparent',
            fontFamily: MONO,
            fontSize: 10,
            textTransform: 'uppercase',
            color: value === l ? CYAN : FAINT,
          }}
        >
          {l}
        </UnstyledButton>
      ))}
    </Box>
  );
}

function ShapeChoice({
  on,
  onClick,
  label,
  lines,
  note,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  lines: string[];
  note: string;
}) {
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        // 260 это ширина, на которой образец ссылки ещё влезает целиком; ниже
        // неё вариант уходит на свою строку, а не режет строку конфига.
        flex: '1 1 260px',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 16,
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${on ? `${CYAN}55` : HAIRLINE}`,
        textAlign: 'left',
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Box
          style={{
            width: 15,
            height: 15,
            borderRadius: 8,
            border: `1px solid ${on ? CYAN : '#3A4A60'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {on && <Box style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: CYAN }} />}
        </Box>
        <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 600, color: SNOW }}>{label}</Text>
      </Box>
      <Stack
        gap={5}
        style={{ padding: '11px 12px', borderRadius: 8, backgroundColor: GROUND, border: `1px solid ${HAIRLINE}` }}
      >
        {lines.map((l) => (
          <Text key={l} style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST }}>
            {l}
          </Text>
        ))}
      </Stack>
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: FAINT }}>{note}</Text>
    </UnstyledButton>
  );
}

/**
 * Что ответил адрес.
 *
 * `ok` это «панель достучалась», а не «всё хорошо»: 404 по токену, которого ни
 * у кого нет, это ожидаемый ответ и он зелёный. Красное тут только тогда, когда
 * до адреса не дошли вовсе.
 */
function ProbeResult({ r }: { r: import('@/lib/domain/settings').SubscriptionProbe }) {
  const { t } = useTranslation();
  const tone = r.ok ? MOSS : RED;

  return (
    <Stack
      gap={8}
      style={{
        padding: '14px 16px',
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${tone}33`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 600, color: tone }}>
          {r.ok ? t('deliverySetup.probeOk') : t('deliverySetup.probeBad')}
        </Text>
        <Box style={{ flex: 1 }} />
        <Text style={{ fontFamily: MONO, fontSize: 11, color: FAINT }}>
          {new Date(r.checkedAt).toLocaleTimeString()}
        </Text>
      </Box>
      <Box
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 20,
          paddingTop: 8,
          borderTop: `1px solid ${HAIRLINE}`,
        }}
      >
        <Fact label={t('deliverySetup.probeCode')} value={r.status === 0 ? '-' : String(r.status)} />
        <Fact label={t('deliverySetup.probeMs')} value={`${r.ms} ms`} />
        <Fact
          label={t('deliverySetup.probeTls')}
          value={r.tlsExpiresAt ? new Date(r.tlsExpiresAt).toLocaleDateString() : '-'}
        />
        <Fact label={t('deliverySetup.probeUrl')} value={r.url} wide />
      </Box>
      {r.error && (
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: RED }}>{r.error}</Text>
      )}
    </Stack>
  );
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <Stack gap={3} style={wide ? { flex: 1, minWidth: 0 } : { flexShrink: 0 }}>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 9,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: FAINT,
        }}
      >
        {label}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 13, color: SNOW, overflowWrap: 'anywhere' }}>{value}</Text>
    </Stack>
  );
}
