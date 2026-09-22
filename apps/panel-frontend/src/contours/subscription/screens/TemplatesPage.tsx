import { useTranslation } from 'react-i18next';
import { Box, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { usePageMeta } from '@/lib/ui/usePageMeta';
import { relativeTime } from '@/lib/ui/relativeTime';
import { PrimaryButton } from '@/ui/PrimaryButton';
import {
  isNotImplemented,
  listTemplates,
  templateFormat,
  type SubscriptionTemplate,
  type TemplateType,
} from '@/lib/domain/subscriptionTemplates';
import { templateActions, templatesScreenFacts } from '@/contours/subscription/lib/templateFacts';
import {
  CARD,
  CYAN,
  DIM,
  FAINT,
  HAIRLINE,
  MIST,
  MOSS,
  ROW,
  SNOW,
  WELL,
} from '@/contours/subscription/lib/colors';

/**
 * Шаблоны выдачи: целый клиентский конфиг оператора, в который панель
 * вставляет серверы.
 *
 * Список сгруппирован по типу шаблона, потому что тип решает всё остальное:
 * каркас (YAML или JSON), слот вставки и формат, которым ответит подписка.
 * Внутри типа Default стоит первым и помечен: он единственный, которого нельзя
 * ни удалить, ни переименовать.
 *
 * ⚠ До бэкенда фазы 11 все запросы отвечают 404, и это НЕ ошибка и НЕ пустой
 * список: экран говорит «появится с фазой 11». Три состояния различает
 * `templatesScreenFacts`, разметка ниже только красит.
 */

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

export function TemplatesPage() {
  const { t } = useTranslation();
  usePageMeta([]);

  const query = useQuery({
    queryKey: ['subscription-templates'],
    queryFn: listTemplates,
    // 404 это ответ, а не сбой связи: повторять его нет смысла до фазы 11.
    retry: (count, err) => !isNotImplemented(err) && count < 2,
  });

  const facts = templatesScreenFacts({
    templates: query.data?.templates,
    notImplemented: isNotImplemented(query.error),
  });

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
        <Text style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 500, color: SNOW }}>
          {t('templates.title')}
        </Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: MIST }}>
          {facts.state === 'list' ? t('templates.count', { n: facts.total }) : ''}
        </Text>
        <Box style={{ flex: 1 }} />
        {/* Кнопки живут и на заглушке, но выключены: прятать их значило бы
            скрыть, что экран вообще про это. */}
        <PrimaryButton disabled={facts.state === 'unavailable'}>{t('templates.create')}</PrimaryButton>
      </Box>

      {facts.state === 'unavailable' && <Unavailable />}
      {facts.state === 'empty' && <Empty />}
      {facts.state === 'list' &&
        facts.groups.map((g) => <TypeGroup key={g.type} type={g.type} templates={g.templates} />)}
    </Stack>
  );
}

/** Сервер ещё не умеет этот раздел. Не ошибка: так и должно быть до фазы 11. */
function Unavailable() {
  const { t } = useTranslation();
  return (
    <Box
      style={{
        padding: '28px 22px',
        borderRadius: 12,
        backgroundColor: CARD,
        border: `1px dashed ${HAIRLINE}`,
      }}
    >
      <Stack gap={8}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 14, color: SNOW }}>
          {t('templates.soonTitle')}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '18px', color: MIST, maxWidth: 680 }}>
          {t('templates.soonBody')}
        </Text>
      </Stack>
    </Box>
  );
}

/** Сервер ответил, шаблонов нет. Это приглашение, а не беда. */
function Empty() {
  const { t } = useTranslation();
  return (
    <Box
      style={{
        padding: '28px 22px',
        borderRadius: 12,
        backgroundColor: CARD,
        border: `1px dashed ${HAIRLINE}`,
      }}
    >
      <Stack gap={8}>
        <Text style={{ fontFamily: DISPLAY, fontSize: 14, color: SNOW }}>
          {t('templates.emptyTitle')}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '18px', color: MIST, maxWidth: 680 }}>
          {t('templates.emptyBody')}
        </Text>
      </Stack>
    </Box>
  );
}

function TypeGroup({ type, templates }: { type: TemplateType; templates: SubscriptionTemplate[] }) {
  const { t } = useTranslation();
  return (
    <Stack gap={10}>
      <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: MIST,
          }}
        >
          {type}
        </Text>
        {/* Формат рядом с типом: он и есть ответ на вопрос «кому это уедет». */}
        <Text style={{ fontFamily: MONO, fontSize: 10, color: DIM }}>
          {t('templates.serves', { format: templateFormat(type) })}
        </Text>
      </Box>
      <Stack gap={6}>
        {templates.map((x) => (
          <TemplateRow key={x.id} template={x} />
        ))}
      </Stack>
    </Stack>
  );
}

function TemplateRow({ template }: { template: SubscriptionTemplate }) {
  const { t } = useTranslation();
  const actions = templateActions(template);
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 14px',
        borderRadius: 10,
        backgroundColor: template.isDefault ? ROW : WELL,
        border: `1px solid ${HAIRLINE}`,
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: SNOW }}>{template.name}</Text>
      {actions.protectedReason === 'default' && (
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: MOSS,
            border: `1px solid ${MOSS}44`,
            borderRadius: 6,
            padding: '2px 6px',
          }}
        >
          {t('templates.defaultTag')}
        </Text>
      )}
      <Box style={{ flex: 1 }} />
      <Text style={{ fontFamily: MONO, fontSize: 10, color: FAINT }}>
        {t('templates.edited', { when: relativeTime(template.updatedAt, t).text })}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 10, color: CYAN }}>{t('common.edit')}</Text>
    </Box>
  );
}
