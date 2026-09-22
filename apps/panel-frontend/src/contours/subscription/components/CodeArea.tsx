import { useRef } from 'react';
import { Box } from '@mantine/core';
import { CARD, DIM, FAINT, HAIRLINE, RED, SNOW, WELL } from '@/contours/subscription/lib/colors';

/**
 * Тело шаблона: номера строк слева, моноширинный текст справа, красная
 * подсветка строки, на которую пожаловался сервер.
 *
 * ⚠ Осознанно БЕЗ редактора кода. CodeMirror 6 с YAML и JSON это около 120 КБ
 * gzip отдельным чанком ради экрана, который открывают раз в месяц и на
 * котором тело чаще вставляют целиком, чем правят по символу. Подсветка
 * синтаксиса не отвечает ни на один вопрос оператора; на его единственный
 * вопрос («где ошибка») отвечает номер строки от сервера, и он тут есть.
 *
 * Номера и текст едут вместе: гуттер не скроллится сам по себе, он лежит в том
 * же прокручиваемом слое, поэтому строка 118 в гуттере всегда напротив строки
 * 118 в тексте.
 */
export function CodeArea({
  value,
  onChange,
  errorLine,
  readOnly,
  minRows = 18,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Строка, на которую указал сервер, 1-based. */
  errorLine?: number | null;
  readOnly?: boolean;
  minRows?: number;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const lines = value.length === 0 ? 1 : value.split('\n').length;
  const rows = Math.max(minRows, lines);

  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'stretch',
        width: '100%',
        borderRadius: 10,
        border: `1px solid ${errorLine ? `${RED}66` : HAIRLINE}`,
        backgroundColor: WELL,
        overflow: 'hidden',
      }}
    >
      {/* Гуттер. Он же и есть вся «подсветка»: строка с ошибкой красная и
          заметна с любого места экрана, а остальное тихое. */}
      <Box
        style={{
          flexShrink: 0,
          padding: '12px 10px',
          backgroundColor: CARD,
          borderRight: `1px solid ${HAIRLINE}`,
          textAlign: 'right',
          userSelect: 'none',
        }}
      >
        {Array.from({ length: rows }, (_, i) => i + 1).map((n) => (
          <Box
            key={n}
            style={{
              fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
              fontSize: 12,
              lineHeight: '20px',
              color: n === errorLine ? RED : n <= lines ? FAINT : DIM,
              fontWeight: n === errorLine ? 600 : 400,
            }}
          >
            {n}
          </Box>
        ))}
      </Box>

      <textarea
        ref={areaRef}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(e) => onChange(e.currentTarget.value)}
        rows={rows}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          resize: 'none',
          padding: '12px 14px',
          backgroundColor: 'transparent',
          color: SNOW,
          fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
          fontSize: 12,
          lineHeight: '20px',
          // Пробелы значимы в YAML, перенос по словам сдвинул бы отступы и
          // сделал бы номер строки от сервера бесполезным.
          whiteSpace: 'pre',
          overflowWrap: 'normal',
          overflowX: 'auto',
        }}
      />
    </Box>
  );
}
