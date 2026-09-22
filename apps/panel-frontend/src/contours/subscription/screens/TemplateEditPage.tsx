import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, Select, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage } from '@/lib/net/client';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { PrimaryButton } from '@/ui/PrimaryButton';
import {
  TEMPLATE_TYPES,
  createTemplate,
  dryRunTemplate,
  isNotImplemented,
  listTemplates,
  templateBodyLanguage,
  templateFormat,
  templateRefusal,
  updateTemplate,
  type TemplateDryRun,
  type TemplateType,
} from '@/lib/domain/subscriptionTemplates';
import {
  dryRunFacts,
  dryRunForBody,
  templateEditorFacts,
} from '@/contours/subscription/lib/templateFacts';
import { CodeArea } from '@/contours/subscription/components/CodeArea';
import { AMBER, CARD, CYAN, DIM, FAINT, HAIRLINE, MIST, MOSS, RED, SNOW } from '@/contours/subscription/lib/colors';

/**
 * Один шаблон: тип, имя и тело.
 *
 * Тип выбирается ТОЛЬКО при создании. Он решает каркас (YAML или JSON), слот
 * вставки и формат, которым ответит подписка, поэтому смена типа у готового
 * шаблона это не правка, а другой шаблон: тело от mihomo в sing-box не
 * переносится ни строчкой.
 *
 * Имя `Default` не редактируется: оно зарезервировано контрактом, по нему
 * шаблон находят и восстанавливают.
 */

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

export function TemplateEditPage() {
  const { t } = useTranslation();
  const { id = 'new' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';

  const query = useQuery({
    queryKey: ['subscription-templates'],
    queryFn: listTemplates,
    retry: (count, err) => !isNotImplemented(err) && count < 2,
  });
  const template = query.data?.templates.find((x) => x.id === id) ?? null;

  const [type, setType] = useState<TemplateType>('mihomo');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /** Строка, на которую указал сервер в TEMPLATE_INVALID. */
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [nameTaken, setNameTaken] = useState(false);

  // Заполняем один раз на шаблон и сравнением в рендере, а не эффектом: эффект
  // перетирал бы правку на каждом фоновом обновлении списка.
  if (template && loadedFor !== template.id) {
    setLoadedFor(template.id);
    setType(template.type);
    setName(template.name);
    setBody(template.body);
  }

  usePageMeta([]);

  const dirty = isNew
    ? name.trim() !== '' || body.trim() !== ''
    : template
      ? name !== template.name || body !== template.body
      : false;

  const facts = templateEditorFacts({
    isNew,
    isDefault: template?.isDefault ?? false,
    name,
    body,
    dirty,
  });

  /** Тело, по которому сделан показанный прогон. `null` = прогона не было. */
  const [ranForBody, setRanForBody] = useState<string | null>(null);
  const [run, setRun] = useState<TemplateDryRun | null>(null);
  const dry = dryRunFacts(dryRunForBody(run, ranForBody, body));

  const dryRun = useMutation({
    mutationFn: () => dryRunTemplate({ type, body }),
    onSuccess: (result) => {
      setRun(result);
      setRanForBody(body);
    },
    onError: (err) => {
      // 404 это «фаза 11 не доехала», и звать чинить нечего: говорим словами.
      notifications.show({
        color: isNotImplemented(err) ? 'yellow' : 'red',
        title: t('templates.dryRunFailed'),
        message: isNotImplemented(err) ? t('templates.dryRunUnavailable') : apiErrorMessage(err),
      });
    },
  });

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? createTemplate({ type, name: name.trim(), body })
        : updateTemplate(id, { name: name.trim(), body }),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['subscription-templates'] });
      notifications.show({ color: 'green', message: t('common.saved') });
      navigate(`/subscription/templates/${saved.id}`);
    },
    onError: (err) => {
      setErrorLine(null);
      setNameTaken(false);
      setRefusal(null);
      const r = templateRefusal(err);
      // Отказы контракта остаются НА ЭКРАНЕ у своего места: позиция строки
      // рядом с телом, занятое имя рядом с именем. Тост унёс бы и то и другое.
      if (r?.code === 'TEMPLATE_INVALID') {
        setErrorLine(r.line ?? null);
        setRefusal(r.message ?? t('templates.invalidNoMessage'));
        return;
      }
      if (r?.code === 'TEMPLATE_NAME_TAKEN') {
        setNameTaken(true);
        return;
      }
      notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) });
    },
  });

  /**
   * Сохранение с оглядкой на прогон.
   *
   * Отказ ядра сохранять не даёт вовсе (кнопка выключена). Жалобы панели
   * сохранять не запрещают, но спрашивают: шаблон без слота это пустая
   * подписка у всех, кто попал на это правило, и узнать об этом от клиентов
   * дороже, чем ответить на один вопрос.
   */
  function attemptSave() {
    if (dry?.needsConfirm) {
      modals.openConfirmModal({
        title: t('templates.confirmTitle'),
        children: (
          <Stack gap={6}>
            {dry.warnings.map((w) => (
              <Text key={w} style={{ fontFamily: DISPLAY, fontSize: 13, color: SNOW }}>
                {w}
              </Text>
            ))}
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: MIST }}>
              {t('templates.confirmBody')}
            </Text>
          </Stack>
        ),
        labels: { confirm: t('common.save'), cancel: t('common.cancel') },
        onConfirm: () => save.mutate(),
      });
      return;
    }
    save.mutate();
  }

  if (!isNew && query.isSuccess && !template) {
    return <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: MIST }}>{t('templates.gone')}</Text>;
  }

  return (
    <Stack gap={16}>
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
        <Text style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 500, color: SNOW }}>
          {isNew ? t('templates.newTitle') : name}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: FAINT }}>
          {t('templates.serves', { format: templateFormat(type) })} ·{' '}
          {templateBodyLanguage(type).toUpperCase()}
        </Text>
        <Box style={{ flex: 1 }} />
        {facts.blocker && (
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, color: FAINT }}>
            {t(`templates.blocker.${facts.blocker}`)}
          </Text>
        )}
        <BarButton disabled={body.trim() === '' || dryRun.isPending} onClick={() => dryRun.mutate()}>
          {dryRun.isPending ? t('templates.dryRunning') : t('templates.dryRun')}
        </BarButton>
        <PrimaryButton
          disabled={!facts.canSave || save.isPending || dry?.canSave === false}
          onClick={attemptSave}
        >
          {save.isPending ? t('templates.saving') : t('common.save')}
        </PrimaryButton>
      </Box>

      <Box style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
        <Stack gap={5} style={{ width: 220 }}>
          <Label>{t('templates.type')}</Label>
          <Select
            data={[...TEMPLATE_TYPES]}
            value={type}
            disabled={!facts.canPickType}
            allowDeselect={false}
            onChange={(v) => v && setType(v as TemplateType)}
          />
          {/* Не «поле выключено», а почему: тип это каркас и слот вставки, и
              перенести тело из одного в другой нельзя. */}
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: DIM }}>
            {facts.canPickType ? t('templates.typeHintNew') : t('templates.typeHintFixed')}
          </Text>
        </Stack>

        <Stack gap={5} style={{ flex: 1, minWidth: 0 }}>
          <Label>{t('templates.name')}</Label>
          <TextInput
            value={name}
            disabled={!facts.canRename}
            error={nameTaken}
            onChange={(e) => {
              setName(e.currentTarget.value);
              setNameTaken(false);
            }}
          />
          <Text
            style={{
              fontFamily: DISPLAY,
              fontSize: 11,
              lineHeight: '15px',
              color: nameTaken ? RED : DIM,
            }}
          >
            {nameTaken
              ? t('templates.nameTaken')
              : facts.canRename
                ? t('templates.nameHint')
                : t('templates.nameDefaultLocked')}
          </Text>
        </Stack>
      </Box>

      <Stack gap={6}>
        <Label>{t('templates.body')}</Label>
        <CodeArea value={body} onChange={setBody} errorLine={errorLine} />
        {refusal && (
          <Box
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 9,
              padding: '10px 12px',
              borderRadius: 10,
              backgroundColor: `${RED}0F`,
              border: `1px solid ${RED}33`,
            }}
          >
            <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '16px', color: RED }}>
              {errorLine ? t('templates.invalidAtLine', { line: errorLine }) : t('templates.invalid')}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '16px', color: SNOW, flex: 1 }}>
              {refusal}
            </Text>
          </Box>
        )}
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: DIM }}>
          {t('templates.bodyHint')}
        </Text>
      </Stack>

      {/* Порядок сверху вниз: ответ ЯДРА, жалобы ПАНЕЛИ, потом то, что вышло.
          Первое решает, можно ли сохранять, второе спрашивает, третье это
          просто результат, и читать его без первых двух незачем. */}
      {dry && (
        <Stack gap={10}>
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderRadius: 10,
              backgroundColor: dry.check.ok ? `${MOSS}0F` : `${RED}0F`,
              border: `1px solid ${dry.check.ok ? MOSS : RED}33`,
            }}
          >
            <Box
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                backgroundColor: dry.check.ok ? MOSS : RED,
                flexShrink: 0,
              }}
            />
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: dry.check.ok ? MOSS : RED,
              }}
            >
              {dry.check.ok ? t('templates.checkOk') : t('templates.checkFailed')}
            </Text>
            {/* Слова ядра, не наши: они и есть то, ради чего прогон делается. */}
            {dry.check.message && (
              <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '16px', color: SNOW, flex: 1 }}>
                {dry.check.message}
              </Text>
            )}
          </Box>

          {dry.warnings.length > 0 && (
            <Stack
              gap={5}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                backgroundColor: `${AMBER}0D`,
                border: `1px solid ${AMBER}33`,
              }}
            >
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: AMBER,
                }}
              >
                {t('templates.warnings')}
              </Text>
              {dry.warnings.map((w) => (
                <Text key={w} style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: SNOW }}>
                  {w}
                </Text>
              ))}
              <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: MIST }}>
                {t('templates.warningsNote')}
              </Text>
            </Stack>
          )}

          <Stack gap={6}>
            <Label>{t('templates.rendered')}</Label>
            {/* Тот же инструмент, что слева: те же номера строк, тот же шрифт,
                та же прокрутка. Разный вид у исходника и результата заставлял бы
                сличать их глазами дважды. */}
            <CodeArea value={dry.rendered} onChange={() => {}} readOnly minRows={12} />
            <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: DIM }}>
              {t('templates.renderedHint')}
            </Text>
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

/** Тихая кнопка рядом с основной: своя, а не из соседнего контура. */
function BarButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        height: 36,
        paddingInline: 16,
        borderRadius: 8,
        border: `1px solid ${HAIRLINE}`,
        backgroundColor: CARD,
        color: disabled ? DIM : SNOW,
        fontFamily: MONO,
        fontSize: 11,
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

function Label({ children }: { children: string }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: CYAN,
      }}
    >
      {children}
    </Text>
  );
}
