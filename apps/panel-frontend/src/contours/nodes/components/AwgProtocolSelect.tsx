import { Select, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { FIELD } from '@/contours/nodes/lib/fieldStyles';
import { FAINT } from '@/contours/nodes/lib/colors';
import {
  AWG_PROTOCOLS,
  awgClientHint,
  awgIntended,
  awgLabel,
  awgRuntimeNoteShown,
  type AwgProtocol,
  type AwgRuntime,
} from '@/lib/domain/awg';

/**
 * Выбор поколения AmneziaWG у ноды (фаза 7), одинаковый в мастере создания и
 * на странице ноды.
 *
 * Подсказка под селектором это главное в нём: поколения несовместимы, и
 * оператор должен увидеть, каким клиентом к ноде можно будет подключиться, до
 * сохранения, а не после звонка пользователя. `null` («не задано») показывается
 * как 1.x, потому что так его читает сервер.
 *
 * Серая строка про отдельный процесс у версии 3 появляется, только когда
 * сервер отдаёт `awgRuntime`. У новой ноды его нет вовсе, поэтому в мастере
 * создания этой строки не бывает.
 *
 * Показывать ли селектор вообще, решает вызывающий через `awgSelectorShown`.
 */
export function AwgProtocolSelect({
  value,
  onChange,
  runtime,
}: {
  value: AwgProtocol | null;
  onChange: (value: AwgProtocol) => void;
  runtime?: AwgRuntime | null;
}) {
  const { t } = useTranslation();
  const hint = awgClientHint(value);
  return (
    <Stack gap={6} style={{ maxWidth: 520 }}>
      <Select
        {...FIELD}
        label={t('nodes.form.awgProtocol')}
        description={hint ? t(`nodes.form.${hint}`) : undefined}
        data={AWG_PROTOCOLS.map((g) => ({ value: String(g), label: awgLabel(g) }))}
        value={String(awgIntended(value) ?? 1)}
        allowDeselect={false}
        onChange={(v) => v && onChange(Number(v) as AwgProtocol)}
      />
      {awgRuntimeNoteShown(value, runtime) && (
        <Text style={{ fontSize: 12, lineHeight: '17px', color: FAINT }}>
          {t('nodes.form.awgRuntimeNote')}
        </Text>
      )}
    </Stack>
  );
}
