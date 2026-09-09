import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
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
} from '@/lib/net/api';
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
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isNew = id === 'new';

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
          disabled={createMutation.isPending || updateMutation.isPending}
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
          <IconCheck size={14} stroke={2.4} color={CYAN} />
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, fontWeight: 500, color: SNOW }}>
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
