import { useState } from 'react';
import { Box, Button, PasswordInput, Stack, TextInput, Text, Loader, Center } from '@mantine/core';
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
const CARD = '#0F1A28';
const GROUND = '#08101A';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';
const CYAN2 = '#67E8F9';
const MOSS = '#A7D8B9';
const AMBER = '#F5D585';
const RUST = '#E89B8B';

const DISPLAY = { fontFamily: "'Space Grotesk', Inter, sans-serif" };
const MONO_LABEL = {
  fontFamily: "'Geist Mono', monospace",
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  color: MIST,
};

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
      color: SNOW,
      fontFamily: "'Geist Mono', monospace",
      fontSize: 14,
      height: 46,
    },
  };

  return (
    <Box style={{ minHeight: '100vh', backgroundColor: GROUND, color: SNOW }}>
      {/* Top bar */}
      <Box
        style={{
          height: 76,
          borderBottom: `1px solid ${HAIRLINE}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 40px',
        }}
      >
        <Box style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <Box
            style={{
              width: 22,
              height: 22,
              background: `linear-gradient(135deg, ${CYAN}, ${CYAN2})`,
              transform: 'rotate(45deg)',
              borderRadius: 4,
              boxShadow: `0 0 14px ${CYAN}66`,
            }}
          />
          <Text
            style={{
              ...DISPLAY,
              fontWeight: 500,
              fontSize: 18,
              color: SNOW,
            }}
          >
            {brandName.toLowerCase()}
          </Text>
        </Box>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <Text style={MONO_LABEL}>
            {t('loginPage.topbarVersion', { version: __APP_VERSION__ })}
          </Text>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: statusColor,
                boxShadow: `0 0 6px ${statusColor}99`,
              }}
            />
            <Text style={MONO_LABEL}>{statusLabel}</Text>
          </Box>
          <LanguageSwitcher />
        </Box>
      </Box>

      {/* Content */}
      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: 80,
          padding: '120px 120px 80px',
          maxWidth: 1440,
          margin: '0 auto',
        }}
      >
        {/* Left: hero */}
        <Box>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: CYAN,
                boxShadow: `0 0 6px ${CYAN}99`,
              }}
            />
            <Text style={MONO_LABEL}>{t('loginPage.signInBadge')}</Text>
          </Box>
          <Text
            style={{
              ...DISPLAY,
              fontSize: 96,
              fontWeight: 500,
              letterSpacing: '-0.03em',
              lineHeight: 1,
              color: SNOW,
              marginBottom: 32,
            }}
          >
            {t('loginPage.heroLine1')}
            <br />
            {t('loginPage.heroLine2')}
          </Text>
          <Text
            style={{
              color: MIST,
              fontSize: 16,
              lineHeight: 1.55,
              maxWidth: 520,
              marginBottom: 56,
            }}
          >
            {t('loginPage.heroDescription')}
          </Text>
          <Box
            style={{
              display: 'flex',
              gap: 32,
              paddingTop: 24,
              borderTop: `1px solid ${HAIRLINE}`,
              maxWidth: 520,
            }}
          >
            {[t('loginPage.feature1'), t('loginPage.feature2'), t('loginPage.feature3')].map((label) => (
              <Box key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: CYAN,
                    boxShadow: `0 0 6px ${CYAN}99`,
                  }}
                />
                <Text
                  style={{
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: SNOW,
                  }}
                >
                  {label}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Right: form */}
        <Box>
          <Box
            style={{
              backgroundColor: CARD,
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 14,
              padding: '32px 32px 28px',
              boxShadow: `0 20px 60px ${GROUND}cc`,
            }}
          >
            <Text style={{ ...MONO_LABEL, marginBottom: 8 }}>{t('loginPage.credentialsLabel')}</Text>
            <Text
              style={{
                ...DISPLAY,
                fontSize: 24,
                fontWeight: 500,
                color: SNOW,
                marginBottom: 28,
                letterSpacing: '-0.01em',
              }}
            >
              {isBootstrap
                ? t('loginPage.bootstrapTo', { brand: brandName })
                : t('loginPage.signInTo', { brand: brandName })}
            </Text>

            <form onSubmit={form.onSubmit((vals) => submitMutation.mutate(vals))}>
              <Stack gap="md">
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
                <Button
                  type="submit"
                  loading={submitMutation.isPending}
                  fullWidth
                  style={{
                    // calmed primary cyan (matches the --mantine-color-cyan-filled
                    // override + PrimaryButton); the neon CYAN stays only on the
                    // small accent dots above.
                    backgroundColor: '#2A93D1',
                    color: GROUND,
                    fontWeight: 500,
                    height: 48,
                    fontSize: 13,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    marginTop: 4,
                  }}
                >
                  {isBootstrap
                    ? t('loginPage.createAdminAction')
                    : requires2fa
                      ? t('loginPage.twofaVerify')
                      : t('loginPage.continueAction')}
                </Button>
              </Stack>
            </form>

            {isBootstrap && (
              <Box
                style={{
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: `1px solid ${HAIRLINE}`,
                }}
              >
                <Text style={{ color: MIST, fontSize: 12, lineHeight: 1.5 }}>
                  {t('loginPage.bootstrapHint')}
                </Text>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
