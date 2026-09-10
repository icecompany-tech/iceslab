import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconBolt, IconCheck, IconPlus } from '@tabler/icons-react';
import {
  createProfile,
  listProfiles,
  updateProfile,
  type CreateProfileInput,
  type UpdateProfileInput,
} from '@/lib/domain/profiles';
import { ProfileFormModal } from '@/contours/profiles/components/ProfileFormModal';
import { usePageMeta } from '@/lib/ui/usePageMeta';

/**
 * Create / edit a profile as a page. A profile is a protocol template with a
 * dozen decisions in it (core, transport, security, REALITY keys), and those
 * decisions deserve the width of the page rather than a dialog that scrolls
 * inside itself.
 *
 * The form body is the existing editor rendered inline: it already knows every
 * protocol option and the recipe registry, and forking it would give two
 * editors to keep in sync.
 */

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

export function ProfileEditPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();

  /**
   * Arriving from "start from a recipe" on the empty library: put the rail in
   * front of the operator instead of leaving them to find it beside a form
   * they have never seen.
   */
  useEffect(() => {
    if (search.get('from') !== 'recipe') return;
    const timer = setTimeout(() => {
      const rail = document.querySelector('.recipes-slot');
      rail?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      rail?.querySelector('input')?.focus();
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';

  // The editor tells the bar when the operator is looking at a Telegram view
  // the panel cannot create yet. Memoised because the form raises it from an
  // effect, and a fresh function every render would loop.
  const [previewing, setPreviewing] = useState(false);
  const handlePreviewChange = useCallback((v: boolean) => setPreviewing(v), []);

  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: () => listProfiles() });
  const profile = isNew ? null : (profilesQuery.data?.profiles.find((p) => p.id === id) ?? null);

  const createMutation = useMutation({
    mutationFn: createProfile,
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      notifications.show({ color: 'green', message: t('profiles.notify.created') });
      navigate(`/profiles/${saved.id}`, { replace: true });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateProfileInput) => updateProfile(profile!.id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      notifications.show({ color: 'green', message: t('profiles.notify.updated') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  usePageMeta([isNew ? t('profileEdit.newCrumb') : (profile?.name ?? '')]);

  if (!profile && !isNew) {
    return (
      <Box style={{ padding: 40, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
        <Stack align="center" gap={14}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 500, color: SNOW }}>
            {profilesQuery.isLoading ? t('common.loading') : t('profileEdit.notFound')}
          </Text>
          {!profilesQuery.isLoading && (
            <PageButton onClick={() => navigate('/profiles')}>
              {t('profileEdit.backToList')}
            </PageButton>
          )}
        </Stack>
      </Box>
    );
  }

  return (
    <Stack gap={16}>
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          height: 64,
          padding: '8px 8px 8px 14px',
          borderRadius: 10,
          backgroundColor: CARD,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: `${CYAN}1A`,
            border: `1px solid ${CYAN}33`,
            color: CYAN,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isNew ? <IconPlus size={18} stroke={2} /> : <IconBolt size={18} stroke={1.8} />}
        </Box>
        <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, color: SNOW }}>
          {isNew ? t('profileEdit.newTitle') : profile!.name}
        </Text>
        <Text
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: MIST,
          }}
        >
          {isNew ? t('profileEdit.newSubtitle') : t('profileEdit.editSubtitle')}
        </Text>
        <Box style={{ flex: 1 }} />
        <PageButton onClick={() => navigate('/profiles')}>{t('common.cancel')}</PageButton>
        {/* Submits the form below by id: the artboard puts the primary action
            in the bar, where it stays reachable without scrolling to the end
            of a long protocol form. */}
        <UnstyledButton
          component="button"
          type="submit"
          form="profile-form"
          disabled={previewing || createMutation.isPending || updateMutation.isPending}
          title={previewing ? t('profiles.telegramPreview.saveBlocked') : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 38,
            padding: '0 16px',
            borderRadius: 8,
            backgroundColor: WELL,
            border: `1px solid ${HAIRLINE}`,
            flexShrink: 0,
            opacity: previewing ? 0.45 : 1,
            cursor: previewing ? 'not-allowed' : 'pointer',
          }}
        >
          <IconCheck size={14} stroke={2.4} color={previewing ? MIST : CYAN} />
          <Text
            style={{
              fontFamily: DISPLAY,
              fontSize: 13,
              fontWeight: 500,
              color: previewing ? MIST : SNOW,
            }}
          >
            {isNew ? t('profileEdit.create') : t('common.save')}
          </Text>
        </UnstyledButton>
      </Box>

      {/* The editor itself, rendered inline. Its own submit button lives at the
          bottom of the form, so the bar above only offers the way out. */}
      <ProfileFormModal
        inline
        opened
        onClose={() => navigate('/profiles')}
        onPreviewChange={handlePreviewChange}
        profile={profile}
        loading={createMutation.isPending || updateMutation.isPending}
        onSubmit={async (input, mode) => {
          if (mode === 'create') await createMutation.mutateAsync(input as CreateProfileInput);
          else await updateMutation.mutateAsync(input as UpdateProfileInput);
        }}
      />
    </Stack>
  );
}

function PageButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 38,
        padding: '0 16px',
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${HAIRLINE}`,
        flexShrink: 0,
      }}
    >
      {primary && <IconCheck size={14} stroke={2.4} color={CYAN} />}
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, color: primary ? SNOW : MIST }}>
        {children}
      </Text>
    </UnstyledButton>
  );
}
