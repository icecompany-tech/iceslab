import { Menu, UnstyledButton, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { updateSettings } from '@/lib/domain/settings';

const LANGS = [
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
] as const;

const MIST = '#7A8BA3';

/**
 * Compact language picker for the topbar - a hairline pill holding the
 * translate glyph, the 2-letter code and a chevron, opening a dropdown with
 * full names. Persists to localStorage via i18next's LanguageDetector cache.
 *
 * When `persist` is set (authed surfaces only - NOT the login page, where the
 * settings PUT would 401), the chosen language is also mirrored to the
 * `defaultLocale` panel setting so the public /sub landing page defaults to the
 * same language the operator runs the panel in. Fire-and-forget: a failed
 * persist never blocks the UI language change.
 */
export function LanguageSwitcher({ persist = false }: { persist?: boolean }) {
  const { i18n } = useTranslation();
  const current =
    LANGS.find((l) => l.code === i18n.resolvedLanguage) ?? LANGS[0];

  const pick = (code: (typeof LANGS)[number]['code']) => {
    void i18n.changeLanguage(code);
    if (persist) {
      void updateSettings({ defaultLocale: code }).catch(() => {});
    }
  };

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <UnstyledButton
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            height: 28,
            paddingInline: 10,
            borderRadius: 8,
            backgroundColor: '#0F1A28',
            border: '1px solid #1C2A3D',
            cursor: 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path d="M4 5h7" fill="none" stroke={MIST} strokeWidth="1.9" strokeLinecap="round" />
            <path d="M7 4c0 4.8 -1.7 8 -4 10" fill="none" stroke={MIST} strokeWidth="1.9" strokeLinecap="round" />
            <path d="M5 9c0 2.1 2.7 4.5 6 5" fill="none" stroke={MIST} strokeWidth="1.9" strokeLinecap="round" />
            <path
              d="M12 20l4 -9l4 9"
              fill="none"
              stroke={MIST}
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M13.5 17h5" fill="none" stroke={MIST} strokeWidth="1.9" strokeLinecap="round" />
          </svg>
          <Text
            style={{
              fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
              fontSize: 10,
              letterSpacing: '0.1em',
              lineHeight: '12px',
              textTransform: 'uppercase',
              color: '#C8D4E3',
            }}
          >
            {current.code}
          </Text>
          <svg width="11" height="11" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path
              d="M6 9l6 6l6 -6"
              fill="none"
              stroke={MIST}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        {LANGS.map((l) => (
          <Menu.Item
            key={l.code}
            onClick={() => pick(l.code)}
            leftSection={l.flag}
            rightSection={
              i18n.resolvedLanguage === l.code ? (
                <Text size="xs" c="teal">
                  ✓
                </Text>
              ) : null
            }
          >
            {l.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
