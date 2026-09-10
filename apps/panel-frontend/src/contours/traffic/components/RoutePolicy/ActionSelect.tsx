import type { RouteAction } from '@/lib/domain/routePolicies';
import { ACTIONS, ACTION_TONE, ACTION_W } from '@/contours/traffic/lib/routeActions';
import { Box, Menu, Text, UnstyledButton } from '@mantine/core';
import { CARD, CYAN, DISPLAY, EDGE, FAINT, HAIRLINE, MIST, SHADOW_INK, SNOW, WELL } from '@/contours/traffic/lib/colors';
import { ChevronIcon, TickIcon } from '@/contours/traffic/components/RoutePolicy/icons';
import { useTranslation } from 'react-i18next';
export function ActionSelect({
  value,
  muted,
  choices = ACTIONS,
  labelKey = 'routes.action',
  width = ACTION_W,
  height = 32,
  className,
  onChange,
}: {
  value: RouteAction;
  muted?: boolean;
  /** Which actions this layer can actually take. A device cannot use WARP. */
  choices?: RouteAction[];
  labelKey?: string;
  width?: number;
  height?: number;
  /** Hands the column width to CSS, which can shrink it on narrow screens. */
  className?: string;
  onChange: (a: RouteAction) => void;
}) {
  const { t } = useTranslation();
  const tone = muted ? SHADOW_INK : ACTION_TONE[value];
  const ACTION_W = width;
  const ACTIONS = choices;
  return (
    <Menu position="bottom-start" width={ACTION_W} withinPortal>
      <Menu.Target>
        <UnstyledButton
          type="button"
          className={className}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            height,
            paddingInline: 10,
            width: className ? undefined : ACTION_W,
            flexShrink: 0,
            borderRadius: 7,
            backgroundColor: WELL,
            border: `1px solid ${EDGE}`,
          }}
        >
          <Box style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
          <Text
            style={{
              fontFamily: DISPLAY,
              fontSize: 13,
              lineHeight: '16px',
              color: muted ? SHADOW_INK : SNOW,
              flex: 1,
              minWidth: 0,
              textAlign: 'left',
            }}
          >
            {t(`${labelKey}.${value}`)}
          </Text>
          <ChevronIcon size={11} color={FAINT} />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
        {ACTIONS.map((a) => (
          <Menu.Item key={a} onClick={() => onChange(a)} style={{ padding: '7px 10px' }}>
            <Box style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Box
                style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: ACTION_TONE[a], flexShrink: 0 }}
              />
              <Text
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 13,
                  lineHeight: '16px',
                  color: a === value ? SNOW : MIST,
                  flex: 1,
                }}
              >
                {t(`${labelKey}.${a}`)}
              </Text>
              {a === value && <TickIcon size={12} color={CYAN} />}
            </Box>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
