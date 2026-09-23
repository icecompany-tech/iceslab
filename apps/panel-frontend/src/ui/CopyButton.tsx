import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconCopy, IconX } from '@tabler/icons-react';
import { Text, UnstyledButton } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { CYAN, FAINT, GROUND, HAIRLINE, MIST, MOSS, RED } from '@/lib/ui/tokens';
import { copyToClipboard } from '@/lib/ui/clipboard';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/** Сколько держится «Скопировано», прежде чем кнопка вернётся к своей подписи. */
const CONFIRM_MS = 1500;

/**
 * Кнопка копирования, которая говорит, что скопировала.
 *
 * Голая кнопка без наведения, нажатия и подтверждения на живой панели
 * «визуально не кликалась» (владелец, 23.09): оператор жал и не знал, ушло ли
 * что-то в буфер. Здесь три состояния: наведение (рамка ярче), «Скопировано»
 * с галкой на полторы секунды, и «Не скопировалось», если буфер отказал: копия
 * на http без secure context может не случиться, и подтверждать её тогда нельзя.
 *
 * Жила в ящике пользователя; переехала в `ui/`, когда понадобилась строке ядра
 * на странице ноды (контуры друг друга не импортируют).
 *
 * `outline` для строк в карточке, `solid` для главной кнопки ссылки подписки.
 */
export function CopyButton({
  text,
  label,
  title,
  disabled = false,
  variant = 'outline',
}: {
  text: string;
  label: string;
  title?: string;
  disabled?: boolean;
  variant?: 'outline' | 'solid';
}) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(false);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  async function onClick() {
    if (disabled) return;
    const ok = await copyToClipboard(text);
    setState(ok ? 'copied' : 'failed');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), CONFIRM_MS);
  }

  const solid = variant === 'solid';
  const tone = disabled ? FAINT : state === 'copied' ? MOSS : state === 'failed' ? RED : solid ? GROUND : MIST;
  const Icon = state === 'copied' ? IconCheck : state === 'failed' ? IconX : IconCopy;
  const text_ = state === 'copied' ? t('common.copied') : state === 'failed' ? t('common.copyFailed') : label;

  return (
    <UnstyledButton
      onClick={() => void onClick()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      title={title}
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        flexShrink: 0,
        height: solid ? undefined : 26,
        padding: solid ? '5px 10px' : undefined,
        paddingInline: solid ? undefined : 8,
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        backgroundColor: solid ? (state === 'idle' ? CYAN : `${CYAN}24`) : 'transparent',
        border: solid
          ? `1px solid ${state === 'idle' ? CYAN : `${CYAN}55`}`
          : `1px solid ${!disabled && hover ? `${CYAN}55` : HAIRLINE}`,
        filter: solid && hover && !disabled && state === 'idle' ? 'brightness(1.1)' : undefined,
        transition: 'border-color 120ms, background-color 120ms, filter 120ms',
        color: tone,
      }}
    >
      {(!solid || state !== 'idle') && <Icon size={12} stroke={1.8} color={tone} />}
      <Text style={{ fontFamily: DISPLAY, fontSize: solid ? 12 : 11, fontWeight: solid ? 600 : 400, color: tone }}>
        {text_}
      </Text>
    </UnstyledButton>
  );
}
