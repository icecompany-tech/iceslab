import { useState } from 'react';
import { Box, PasswordInput, Stack, TextInput, Text, Loader, Center, UnstyledButton } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchAuthStatus, login, register, type LoginResponse, api } from '../lib/api';
import { useAuth } from '../stores/auth';
import { useBrandName } from '../hooks/useBrandName';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

const HAIRLINE = '#1C2A3D';
const EDGE = '#2C3A4E';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const GROUND = '#08101A';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5D585';
const RUST = '#E89B8B';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

/** The one caption style the whole page runs on: mono, 10px, wide tracking. */
const MONO_LABEL = {
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: '0.14em',
  lineHeight: '12px',
  textTransform: 'uppercase' as const,
  color: MIST,
};

/** Accent dot in front of a caption. Flat fill, no glow. */
function Dot({ color = CYAN }: { color?: string }) {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: color,
        flexShrink: 0,
      }}
    />
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const brandName = useBrandName();
  const { t } = useTranslation();

  const statusQuery = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: fetchAuthStatus,
    staleTime: 0,
  });

  // Live backend health probe, polls /health every 10s so the top-bar
  // status pill reflects reality, not a static "all systems normal" label.
  // /health is public (no auth gate) so we can call it from the login page.
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data } = await api.get<{ status: string }>('/health');
      return data;
    },
    refetchInterval: 10_000,
    retry: false,
  });
  const backendStatus: 'normal' | 'degraded' | 'down' =
    healthQuery.isError ? 'down' :
    healthQuery.data?.status === 'ok' ? 'normal' : 'degraded';
  const statusColor =
    backendStatus === 'normal' ? MOSS :
    backendStatus === 'degraded' ? AMBER : RUST;
  const statusLabel = t(
    backendStatus === 'normal' ? 'loginPage.topbarStatusNormal' :
    backendStatus === 'degraded' ? 'loginPage.topbarStatusDegraded' :
    'loginPage.topbarStatusDown'
  );

  // K8 - when the admin has 2FA on, the first login attempt returns
  // requires2fa; we then reveal a code field and resubmit with it.
  const [requires2fa, setRequires2fa] = useState(false);

  const form = useForm({
    initialValues: { username: '', password: '', totpCode: '' },
    validate: {
      username: (v) => (v.length < 3 ? t('validation.usernameMin3') : null),
      password: (v) => (v.length < 8 ? t('validation.passwordMin8') : null),
    },
  });

  const isBootstrap = statusQuery.data?.registration.enabled ?? false;

  const submitMutation = useMutation({
    mutationFn: async ({
      username,
      password,
      totpCode,
    }: {
      username: string;
      password: string;
      totpCode: string;
    }) => {
      if (isBootstrap) {
        await register(username, password);
      }
      return login(username, password, totpCode || undefined);
    },
    onSuccess: (data: LoginResponse) => {
      setRequires2fa(false);
      setSession(data.token, data.admin);
      navigate('/users', { replace: true });
    },
    onError: (err) => {
      const data = isAxiosError(err)
        ? (err.response?.data as { requires2fa?: boolean; error?: string } | undefined)
        : undefined;
      if (data?.requires2fa) {
        // Password was correct; reveal the 2FA field (or flag a wrong code).
        const wasAsking = requires2fa;
        setRequires2fa(true);
        if (wasAsking && data.error === 'INVALID_TOTP') {
          notifications.show({
            color: 'red',
            title: t('loginPage.twofaTitle'),
            message: t('loginPage.twofaInvalid'),
          });
        }
        return;
      }
      notifications.show({
        color: 'red',
        title: t('loginPage.signInFailed'),
        message: err instanceof Error ? err.message : t('loginPage.unknownError'),
      });
    },
  });

  if (statusQuery.isLoading) {
    return (
      <Center h="100%" style={{ backgroundColor: GROUND }}>
        <Loader color={CYAN} />
      </Center>
    );
  }

  const inputStyles = {
    label: { ...MONO_LABEL, marginBottom: 6 },
    input: {
      backgroundColor: GROUND,
      borderColor: HAIRLINE,
      borderRadius: 10,
      color: SNOW,
      fontFamily: MONO,
      fontSize: 14,
      height: 46,
      paddingInline: 14,
    },
  };

  const submitLabel = isBootstrap
    ? t('loginPage.createAdminAction')
    : requires2fa
      ? t('loginPage.twofaVerify')
      : t('loginPage.continueAction');

  return (
    <Box
      style={{
        minHeight: '100vh',
        backgroundColor: GROUND,
        color: SNOW,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top bar */}
      <Box
        style={{
          height: 76,
          flexShrink: 0,
          borderBottom: `1px solid ${HAIRLINE}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 40px',
        }}
      >
        <Box style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1, minWidth: 0 }}>
          <Box
            style={{
              width: 22,
              height: 22,
              background: 'linear-gradient(135deg, #7DD3FC, #67E8F9)',
              transform: 'rotate(45deg)',
              borderRadius: 4,
              flexShrink: 0,
            }}
          />
          <Text style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 18, lineHeight: '23px', color: SNOW }}>
            {brandName.toLowerCase()}
          </Text>
        </Box>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
          <Text style={MONO_LABEL}>
            {t('loginPage.topbarVersion', { version: __APP_VERSION__ })}
          </Text>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Dot color={statusColor} />
            <Text style={MONO_LABEL}>{statusLabel}</Text>
          </Box>
          <LanguageSwitcher />
        </Box>
      </Box>

      {/* Content: hero takes the slack, the form column is a fixed 510 lane. */}
      <Box
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 80,
          paddingTop: 120,
          paddingBottom: 80,
          // 360px at the artboard's 1920; narrower screens give the padding
          // back to the hero rather than squeezing the form lane.
          paddingInline: 'clamp(40px, 18.75vw, 360px)',
        }}
      >
        {/* Left: hero */}
        <Box style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 9, paddingBottom: 32 }}>
            <Dot />
            <Text style={MONO_LABEL}>{t('loginPage.signInBadge')}</Text>
          </Box>
          <Text
            style={{
              fontFamily: DISPLAY,
              fontSize: 96,
              fontWeight: 500,
              letterSpacing: '-0.03em',
              lineHeight: '96px',
              color: SNOW,
            }}
          >
            {t('loginPage.heroLine1')}
          </Text>
          <Box style={{ paddingBottom: 32 }}>
            <Text
              style={{
                fontFamily: DISPLAY,
                fontSize: 96,
                fontWeight: 500,
                letterSpacing: '-0.03em',
                lineHeight: '96px',
                color: SNOW,
              }}
            >
              {t('loginPage.heroLine2')}
            </Text>
          </Box>
          <Box style={{ paddingBottom: 56, maxWidth: 520 }}>
            <Text style={{ fontFamily: DISPLAY, color: MIST, fontSize: 16, lineHeight: '25px' }}>
              {t('loginPage.heroDescription')}
            </Text>
          </Box>
          <Box
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 32,
              paddingTop: 24,
              borderTop: `1px solid ${HAIRLINE}`,
              maxWidth: 520,
            }}
          >
            {[t('loginPage.feature1'), t('loginPage.feature2'), t('loginPage.feature3')].map((label) => (
              <Box key={label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <Dot />
                <Text style={{ ...MONO_LABEL, color: SNOW }}>{label}</Text>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Right: form. The card holds the credentials, anything the operator
            has to be told sits under it as its own note. */}
        <Box style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 510, flexShrink: 0 }}>
          <Box
            style={{
              backgroundColor: CARD,
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 14,
              padding: '32px 32px 28px',
            }}
          >
            <Text style={{ ...MONO_LABEL, paddingBottom: 8 }}>{t('loginPage.credentialsLabel')}</Text>
            <Text
              style={{
                fontFamily: DISPLAY,
                fontSize: 24,
                fontWeight: 500,
                lineHeight: '30px',
                letterSpacing: '-0.01em',
                color: SNOW,
                paddingBottom: 28,
              }}
            >
              {isBootstrap
                ? t('loginPage.bootstrapTo', { brand: brandName })
                : t('loginPage.signInTo', { brand: brandName })}
            </Text>

            <form onSubmit={form.onSubmit((vals) => submitMutation.mutate(vals))}>
              <Stack gap={16}>
                <TextInput
                  label={t('login.username')}
                  placeholder="admin"
                  autoComplete="username"
                  styles={inputStyles}
                  {...form.getInputProps('username')}
                />
                <PasswordInput
                  label={t('login.password')}
                  placeholder="••••••••"
                  autoComplete={isBootstrap ? 'new-password' : 'current-password'}
                  styles={inputStyles}
                  {...form.getInputProps('password')}
                />
                {requires2fa && (
                  <TextInput
                    label={t('loginPage.twofaCodeLabel')}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    data-autofocus
                    styles={inputStyles}
                    {...form.getInputProps('totpCode')}
                  />
                )}
                {/* Not a filled primary: on this page the button is the only
                    action, so the accent lives in the arrow and the field
                    stack stays the brightest thing on screen. */}
                <UnstyledButton
                  type="submit"
                  disabled={submitMutation.isPending}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    width: '100%',
                    height: 48,
                    marginTop: 4,
                    borderRadius: 10,
                    backgroundColor: WELL,
                    border: `1px solid ${EDGE}`,
                    opacity: submitMutation.isPending ? 0.6 : 1,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 13,
                      fontWeight: 500,
                      lineHeight: '16px',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: SNOW,
                    }}
                  >
                    {submitLabel}
                  </Text>
                  <svg width="15" height="15" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                    <path d="M5 12h14" fill="none" stroke={CYAN} strokeWidth="2.4" strokeLinecap="round" />
                    <path
                      d="M13 6l6 6l-6 6"
                      fill="none"
                      stroke={CYAN}
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </UnstyledButton>
              </Stack>
            </form>
          </Box>

          {(isBootstrap || requires2fa) && (
            <Box
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '13px 16px',
                borderRadius: 10,
                backgroundColor: CARD,
                border: `1px solid ${HAIRLINE}`,
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path
                  d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"
                  fill="none"
                  stroke={MOSS}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9 12l2 2l4 -4"
                  fill="none"
                  stroke={MOSS}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST, flex: 1 }}>
                {isBootstrap ? t('loginPage.bootstrapHint') : t('loginPage.twofaHint')}
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      <Box
        style={{
          height: 56,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          padding: '0 40px',
          borderTop: `1px solid ${HAIRLINE}`,
        }}
      >
        <Text style={{ ...MONO_LABEL, color: DIM }}>{t('loginPage.footerLicense')}</Text>
        <Text style={{ ...MONO_LABEL, color: DIM, letterSpacing: 0 }}>·</Text>
        <Text style={{ ...MONO_LABEL, color: DIM }}>{t('loginPage.footerHosting')}</Text>
        <Box style={{ flex: 1, minWidth: 0 }} />
        <Text style={{ ...MONO_LABEL, color: DIM }}>icecompany.tech</Text>
      </Box>
    </Box>
  );
}
