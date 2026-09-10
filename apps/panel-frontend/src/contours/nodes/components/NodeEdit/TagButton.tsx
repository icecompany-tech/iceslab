import { useTranslation } from 'react-i18next';
import { CYAN, DISPLAY, FAINT, HAIRLINE, MIST, MONO, SNOW, WELL } from '@/contours/nodes/lib/colors';
import { Text, UnstyledButton } from '@mantine/core';
export function TagButton({
  active,
  label,
  tag,
  onClick,
}: {
  active: boolean;
  label: string;
  tag: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 32,
        paddingInline: 12,
        borderRadius: 8,
        backgroundColor: active ? `${CYAN}1A` : WELL,
        border: `1px solid ${active ? CYAN : HAIRLINE}`,
      }}
    >
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: active ? 500 : 400,
          lineHeight: '16px',
          color: active ? SNOW : MIST,
        }}
      >
        {label}
      </Text>
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: active ? CYAN : FAINT }}>
        {t('nodeEdit.routes.tag', { tag })}
      </Text>
    </UnstyledButton>
  );
}

/** One line of the resolved stack. The left edge says what kind of line it is. */
