import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, Text, UnstyledButton } from '@mantine/core';

/**
 * Две вкладки одних «Настроек подписки»: заголовки ответа на первой, формат,
 * тексты и адрес на второй. Это не соседние пункты меню, поэтому и в сайдбаре
 * пункт остаётся один, а переключатель живёт на самой странице.
 *
 * Каждая вкладка это свой маршрут, то есть уход со страницы. Черновик экрана
 * при этом теряется, поэтому вкладка с несохранёнными правками не уводит
 * молча, а сперва говорит, что именно пропадёт.
 */

const HAIRLINE = '#1C2A3D';
const WELL = '#0B1420';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';
const AMBER = '#F5B14C';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const METADATA = '/subscription/metadata';
const DELIVERY = '/subscription/metadata/delivery';

export function SettingsTabs({ dirty = false }: { dirty?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [pending, setPending] = useState<string | null>(null);

  // Ровное сравнение, а не `startsWith`: «Метаданные» это префикс адреса
  // второй вкладки, и по вхождению подсветились бы обе сразу.
  const here = pathname === DELIVERY ? DELIVERY : METADATA;

  const go = (to: string) => {
    if (to === here) return;
    if (dirty) {
      setPending(to);
      return;
    }
    navigate(to);
  };

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Box style={{ display: 'flex', gap: 8 }}>
        <Tab active={here === METADATA} icon="headers" onClick={() => go(METADATA)}>
          {t('settingsTabs.metadata')}
        </Tab>
        <Tab active={here === DELIVERY} icon="delivery" onClick={() => go(DELIVERY)}>
          {t('settingsTabs.delivery')}
        </Tab>
      </Box>

      {pending && (
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            borderRadius: 8,
            backgroundColor: `${AMBER}14`,
            border: `1px solid ${AMBER}44`,
          }}
        >
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '17px', color: SNOW }}>
              {t('settingsTabs.dirtyTitle')}
            </Text>
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}>
              {t('settingsTabs.dirtyBody')}
            </Text>
          </Box>
          <SmallButton onClick={() => setPending(null)}>{t('settingsTabs.dirtyStay')}</SmallButton>
          <SmallButton
            tone={AMBER}
            onClick={() => {
              const to = pending;
              setPending(null);
              navigate(to);
            }}
          >
            {t('settingsTabs.dirtyLeave')}
          </SmallButton>
        </Box>
      )}
    </Box>
  );
}

function Tab({
  children,
  active,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  icon: 'headers' | 'delivery';
  onClick: () => void;
}) {
  const stroke = active ? CYAN : MIST;
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        height: 38,
        paddingInline: 16,
        borderRadius: 8,
        backgroundColor: active ? `${CYAN}1A` : WELL,
        border: `1px solid ${active ? CYAN : HAIRLINE}`,
      }}
    >
      {icon === 'headers' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M4 6h16M4 12h11M4 18h7" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path
            d="M12 3v11m0 0 4-4m-4 4-4-4"
            fill="none"
            stroke={stroke}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M4 18h16" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: active ? 500 : 400,
          lineHeight: '16px',
          color: active ? SNOW : MIST,
        }}
      >
        {children}
      </Text>
    </UnstyledButton>
  );
}

function SmallButton({
  children,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  tone?: string;
  onClick: () => void;
}) {
  const color = tone ?? MIST;
  return (
    <UnstyledButton
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 30,
        paddingInline: 12,
        borderRadius: 7,
        flexShrink: 0,
        backgroundColor: WELL,
        border: `1px solid ${tone ? `${tone}66` : HAIRLINE}`,
      }}
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '15px', color }}>{children}</Text>
    </UnstyledButton>
  );
}
