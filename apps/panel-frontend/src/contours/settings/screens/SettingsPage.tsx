import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Code,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { copyToClipboard } from '@/lib/ui/clipboard';
import {
  apiErrorMessage,
  createApiToken,
  createRegion,
  deleteApiToken,
  deleteRegion,
  disable2fa,
  enable2fa,
  get2faStatus,
  listApiTokens,
  listRegions,
  getSettings,
  setup2fa,
  updateRegion,
  updateSettings,
  getRecipeSources,
  addRecipeSource,
  updateRecipeSource,
  deleteRecipeSource,
  type ApiToken,
  type Region,
  type TotpSetup,
} from '@/lib/net/api';
import type { RecipeSource } from '@iceslab/shared';

/**
 * Everything that configures the panel itself rather than what it serves:
 * how it is branded, who may call its API, how the admin signs in, the region
 * labels nodes are grouped by, and where recipes come from.
 *
 * Each card owns its own query. React-query dedupes the shared keys, so the
 * bar can count the same things the cards list without threading props.
 */

const HAIRLINE = '#1C2A3D';
const EDGE = '#2C3A4E';
const CARD = '#0F1A28';
const WELL = '#0B1420';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const FAINT = '#5A6B82';
const DIM = '#3A4A60';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';
const VIOLET = '#A78BFA';

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";

export function SettingsPage() {
  const { t } = useTranslation();
  const tokensQuery = useQuery({ queryKey: ['api-tokens'], queryFn: listApiTokens });
  const twofaQuery = useQuery({ queryKey: ['2fa-status'], queryFn: get2faStatus });
  const regionsQuery = useQuery({ queryKey: ['regions'], queryFn: listRegions });
  const sourcesQuery = useQuery({ queryKey: ['recipe-sources'], queryFn: getRecipeSources });

  const twofaOn = twofaQuery.data?.enabled ?? false;

  return (
    <Stack gap={20}>
      {/* Page bar */}
      <Box className="page-bar">
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 16, flexShrink: 0 }}>
          <Box
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: `${CYAN}1A`,
              border: `1px solid ${CYAN}33`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <GearIcon size={18} color={CYAN} />
          </Box>
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {t('settings.title')}
          </Text>
        </Box>

        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />

        <Box className="page-bar-facts">
          <Fact value={tokensQuery.data?.tokens.length ?? 0} label={t('settings.factTokens')} />
          <Dot />
          {/* The one fact worth a colour: an admin panel on the open internet
              without a second factor is the thing to notice here. */}
          <Box style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Box
              style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: twofaOn ? MOSS : AMBER }}
            />
            <Text
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: '0.12em',
                lineHeight: '12px',
                textTransform: 'uppercase',
                color: twofaOn ? MOSS : AMBER,
              }}
            >
              {twofaOn ? t('settings.factTwofaOn') : t('settings.factTwofaOff')}
            </Text>
          </Box>
          <Dot soft="mid" />
          <Fact
            value={regionsQuery.data?.regions.length ?? 0}
            label={t('settings.factRegions')}
            soft="mid"
          />
          <Dot soft />
          <Fact
            value={sourcesQuery.data?.sources.length ?? 0}
            label={t('settings.factSources')}
            soft="soft"
          />
          <Box style={{ flex: 1, minWidth: 0 }} />
        </Box>
      </Box>

      <Box className="page-columns">
        <Box style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0, width: '100%' }}>
          <CustomizationCard />
          <ApiTokensCard />
          <RegionsCard />
        </Box>

        <Box className="page-rail">
          <TwoFactorCard />
          <RecipeSourcesCard />
        </Box>
      </Box>
    </Stack>
  );
}

/* ───── Customization ───────────────────────────────────────────────────── */

function CustomizationCard() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings', 'all'], queryFn: getSettings });

  const [brandName, setBrandName] = useState<string | null>(null);
  // Seed once when the server value lands; null means "not seeded yet".
  if (brandName === null && settingsQuery.data) setBrandName(settingsQuery.data.brandName ?? '');
  const value = brandName ?? '';

  const saveMutation = useMutation({
    mutationFn: () => updateSettings({ brandName: value.trim() || 'Iceslab' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      notifications.show({ color: 'green', message: t('settingsNotify.savedOk') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('settingsNotify.saveErrorTitle'),
        message: apiErrorMessage(err),
      }),
  });

  /**
   * The panel language. It lives here because the topbar carries the project
   * links and nothing else; without this control an operator who picked the
   * wrong language at login could not get back. Picking one also mirrors to
   * `defaultLocale`, so the public /sub page speaks the same language.
   */
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'ru';
  function pickLocale(code: 'ru' | 'en') {
    void i18n.changeLanguage(code);
    // Fire and forget: a failed persist must never block the UI switch.
    void updateSettings({ defaultLocale: code }).catch(() => {});
  }

  return (
    <SectionCard
      tone={VIOLET}
      icon={<PaletteIcon size={16} color={VIOLET} />}
      title={t('settings.customization.title')}
      hint={t('settings.customization.description')}
    >
      <Stack gap={6}>
        <FieldLabel>{t('settings.customization.brandName')}</FieldLabel>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
          <TextInput
            style={{ flex: 1, minWidth: 0 }}
            placeholder="Iceslab"
            value={value}
            onChange={(e) => setBrandName(e.currentTarget.value)}
          />
          <Action
            icon="tick"
            disabled={settingsQuery.isLoading || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {t('common.save')}
          </Action>
        </Box>
        <Hint>{t('settings.customization.brandNameDesc')}</Hint>
      </Stack>

      <Stack gap={6}>
        <FieldLabel>{t('settings.language.title')}</FieldLabel>
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: 3,
            borderRadius: 9,
            backgroundColor: WELL,
            border: `1px solid ${HAIRLINE}`,
            alignSelf: 'flex-start',
          }}
        >
          {(['ru', 'en'] as const).map((code) => {
            const active = code === locale;
            return (
              <UnstyledButton
                key={code}
                type="button"
                onClick={() => pickLocale(code)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 30,
                  paddingInline: 18,
                  borderRadius: 7,
                  backgroundColor: active ? CARD : 'transparent',
                  border: `1px solid ${active ? EDGE : 'transparent'}`,
                }}
              >
                <Text
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: 12,
                    fontWeight: 500,
                    lineHeight: '16px',
                    color: active ? SNOW : MIST,
                  }}
                >
                  {code === 'ru' ? 'Русский' : 'English'}
                </Text>
              </UnstyledButton>
            );
          })}
        </Box>
        <Hint>{t('settings.language.desc')}</Hint>
      </Stack>
    </SectionCard>
  );
}

/* ───── API tokens ──────────────────────────────────────────────────────── */

/** Scopes the create form can mint. Empty means full admin. */
const PROVISION_SCOPES = ['users:read', 'users:write', 'sub:read'];

function ApiTokensCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const tokensQuery = useQuery({ queryKey: ['api-tokens'], queryFn: listApiTokens });

  const createMutation = useMutation({
    mutationFn: createApiToken,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
      setRevealed(created.token);
      closeCreate();
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.createError'), message: apiErrorMessage(err) }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteApiToken,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
      notifications.show({ color: 'green', message: t('settings.tokens.deleted') });
    },
    onError: (err) =>
      notifications.show({ color: 'red', title: t('common.deleteError'), message: apiErrorMessage(err) }),
  });

  function confirmDelete(token: ApiToken) {
    modals.openConfirmModal({
      title: t('settings.tokens.deleteTitle', { name: token.name }),
      children: <Text size="sm">{t('settings.tokens.deleteBody')}</Text>,
      labels: { confirm: t('settings.tokens.revoke'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(token.id),
    });
  }

  const tokens = tokensQuery.data?.tokens ?? [];

  return (
    <SectionCard
      tone={CYAN}
      icon={<KeyIcon size={16} color={CYAN} />}
      title={t('settings.tokens.title')}
      hint={t('settings.tokens.description')}
      action={
        <Action icon="plus" onClick={openCreate}>
          {t('settings.tokens.createButton')}
        </Action>
      }
    >
      <Box
        style={{
          borderRadius: 10,
          backgroundColor: WELL,
          border: `1px solid ${HAIRLINE}`,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <Box className="settings-token-row" style={{ height: 34, paddingInline: 14 }}>
          <ColHead flex>{t('settings.tokens.colName')}</ColHead>
          <ColHead width={130}>{t('settings.tokens.colScope')}</ColHead>
          <ColHead width={110}>{t('settings.tokens.colCreated')}</ColHead>
          <ColHead width={110}>{t('settings.tokens.colLastUsed')}</ColHead>
          <ColHead width={56}>{t('common.actions')}</ColHead>
        </Box>

        {tokens.length === 0 ? (
          <Box style={{ padding: '20px 14px', borderTop: `1px solid ${HAIRLINE}` }}>
            <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: MIST, textAlign: 'center' }}>
              {tokensQuery.isLoading ? t('common.loading') : t('settings.tokens.empty')}
            </Text>
          </Box>
        ) : (
          tokens.map((tok) => (
            <Box
              key={tok.id}
              className="settings-token-row"
              style={{ paddingBlock: 11, paddingInline: 14, borderTop: `1px solid ${HAIRLINE}` }}
            >
              <Text
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: '17px',
                  color: SNOW,
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tok.name}
              </Text>
              <Box style={{ width: 130, flexShrink: 0, display: 'flex' }}>
                <ScopeChip scopes={tok.scopes} />
              </Box>
              <Text
                style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: MIST, width: 110, flexShrink: 0 }}
              >
                {shortDate(tok.createdAt)}
              </Text>
              <Text
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  lineHeight: '14px',
                  color: tok.lastUsedAt ? MIST : DIM,
                  width: 110,
                  flexShrink: 0,
                }}
              >
                {tok.lastUsedAt ? sinceLabel(tok.lastUsedAt, t) : t('settings.tokens.never')}
              </Text>
              <Box style={{ width: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <UnstyledButton
                  type="button"
                  title={t('settings.tokens.copyId')}
                  style={{ display: 'flex' }}
                  onClick={async () => {
                    await copyToClipboard(tok.id);
                    notifications.show({
                      color: 'teal',
                      message: t('settings.tokens.idCopied'),
                      autoClose: 1500,
                    });
                  }}
                >
                  <CopyIcon size={15} color={MIST} />
                </UnstyledButton>
                <UnstyledButton
                  type="button"
                  title={t('settings.tokens.revoke')}
                  style={{ display: 'flex' }}
                  onClick={() => confirmDelete(tok)}
                >
                  <TrashIcon size={15} color={RED} />
                </UnstyledButton>
              </Box>
            </Box>
          ))
        )}
      </Box>

      <Box style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <InfoIcon size={13} color={FAINT} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT, flex: 1 }}>
          {t('settings.tokens.onceNote')}
        </Text>
      </Box>

      <CreateApiTokenModal
        opened={createOpen}
        onClose={closeCreate}
        loading={createMutation.isPending}
        onSubmit={(name, scopes) => createMutation.mutate({ name, scopes })}
      />
      <RevealTokenModal token={revealed} onClose={() => setRevealed(null)} />
    </SectionCard>
  );
}

/** What a token may do, read off the scopes the API actually returns. */
function ScopeChip({ scopes }: { scopes: string[] }) {
  const { t } = useTranslation();
  const full = scopes.length === 0;
  const provisioning =
    scopes.length === PROVISION_SCOPES.length && PROVISION_SCOPES.every((s) => scopes.includes(s));
  const tone = full ? AMBER : provisioning ? CYAN : MIST;
  const label = full
    ? t('settings.tokens.scopeFullShort')
    : provisioning
      ? t('settings.tokens.scopeProvisionShort')
      : t('settings.tokens.scopeCount', { count: scopes.length });
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 20,
        paddingInline: 8,
        borderRadius: 6,
        flexShrink: 0,
        backgroundColor: `${tone}14`,
        border: `1px solid ${tone}2E`,
      }}
      title={full ? undefined : scopes.join(', ')}
    >
      <Text style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: tone }}>{label}</Text>
    </Box>
  );
}

function CreateApiTokenModal({
  opened,
  onClose,
  onSubmit,
  loading,
}: {
  opened: boolean;
  onClose: () => void;
  onSubmit: (name: string, scopes: string[]) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [scopePreset, setScopePreset] = useState('full');
  return (
    <Modal opened={opened} onClose={onClose} title={t('settings.tokens.modalTitle')} size="md">
      <Stack>
        <TextInput
          label={t('settings.tokens.modalName')}
          placeholder={t('settings.tokens.modalNamePlaceholder')}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
          autoFocus
        />
        <Select
          label={t('settings.tokens.modalScopes')}
          data={[
            { value: 'full', label: t('settings.tokens.scopeFull') },
            { value: 'provision', label: t('settings.tokens.scopeProvision') },
          ]}
          value={scopePreset}
          onChange={(v) => setScopePreset(v ?? 'full')}
          allowDeselect={false}
        />
        <Alert color="yellow" variant="light">
          {t('settings.tokens.modalWarning')}
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              if (name.trim().length === 0) return;
              onSubmit(name.trim(), scopePreset === 'provision' ? PROVISION_SCOPES : []);
              setName('');
              setScopePreset('full');
            }}
            loading={loading}
            disabled={name.trim().length === 0}
          >
            {t('settings.tokens.modalSubmit')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RevealTokenModal({ token, onClose }: { token: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!token) return;
    await copyToClipboard(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Modal opened={token !== null} onClose={onClose} title={t('settings.tokens.revealTitle')} size="md">
      <Stack>
        <Alert color="yellow" variant="light">
          {t('settings.tokens.revealHint')}
        </Alert>
        <Code block style={{ fontSize: 12, wordBreak: 'break-all', cursor: 'pointer' }} onClick={copy}>
          {token}
        </Code>
        <Group justify="flex-end">
          <Button variant="light" onClick={copy} color={copied ? 'teal' : undefined}>
            {copied ? t('settings.tokens.revealCopied') : t('settings.tokens.revealCopy')}
          </Button>
          <Button onClick={onClose}>{t('settings.tokens.revealDone')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/* ───── Regions ─────────────────────────────────────────────────────────── */

function RegionsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const regionsQuery = useQuery({ queryKey: ['regions'], queryFn: listRegions });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState<Region | null>(null);

  const fail = (title: string) => (err: unknown) =>
    notifications.show({ color: 'red', title, message: apiErrorMessage(err) });

  const createMutation = useMutation({
    mutationFn: createRegion,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regions'] });
      setName('');
      setCode('');
      notifications.show({ color: 'green', message: t('regions.notify.created') });
    },
    onError: fail(t('common.createError')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; code?: string } }) =>
      updateRegion(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regions'] });
      setEditing(null);
      notifications.show({ color: 'green', message: t('regions.notify.updated') });
    },
    onError: fail(t('common.saveError')),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRegion,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regions'] });
      qc.invalidateQueries({ queryKey: ['nodes'] });
      notifications.show({ color: 'green', message: t('regions.notify.deleted') });
    },
    onError: fail(t('common.deleteError')),
  });

  function confirmDelete(r: Region) {
    modals.openConfirmModal({
      title: t('regions.deleteTitle', { name: r.name }),
      children: (
        <Text size="sm">
          {r.nodeCount && r.nodeCount > 0
            ? t('regions.deleteWithNodes', { count: r.nodeCount })
            : t('regions.deleteSafe')}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(r.id),
    });
  }

  const regions = regionsQuery.data?.regions ?? [];

  return (
    <SectionCard
      tone={MOSS}
      icon={<GlobeIcon size={16} color={MOSS} />}
      title={t('regions.title')}
      hint={t('regions.description')}
    >
      {regions.length === 0 ? (
        <Hint>{t('regions.empty')}</Hint>
      ) : (
        <Box className="settings-regions">
          {regions.map((r) =>
            editing?.id === r.id ? (
              <RegionEditRow
                key={r.id}
                region={r}
                loading={updateMutation.isPending}
                onCancel={() => setEditing(null)}
                onSave={(input) => updateMutation.mutate({ id: r.id, input })}
              />
            ) : (
              <Box
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 11px',
                  borderRadius: 10,
                  backgroundColor: WELL,
                  border: `1px solid ${HAIRLINE}`,
                  minWidth: 0,
                }}
              >
                <Box
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    height: 22,
                    paddingInline: 8,
                    borderRadius: 6,
                    flexShrink: 0,
                    backgroundColor: `${CYAN}14`,
                    border: `1px solid ${CYAN}2E`,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      lineHeight: '12px',
                      color: CYAN,
                    }}
                  >
                    {r.code}
                  </Text>
                </Box>
                <Text
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: '17px',
                    color: SNOW,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.name}
                </Text>
                <Text
                  style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: FAINT, flexShrink: 0 }}
                >
                  {t('regions.nodesCount', { count: r.nodeCount ?? 0 })}
                </Text>
                <UnstyledButton
                  type="button"
                  title={t('common.edit')}
                  style={{ display: 'flex', flexShrink: 0 }}
                  onClick={() => setEditing(r)}
                >
                  <PencilIcon size={14} color={MIST} />
                </UnstyledButton>
                <UnstyledButton
                  type="button"
                  title={t('common.delete')}
                  style={{ display: 'flex', flexShrink: 0 }}
                  onClick={() => confirmDelete(r)}
                >
                  <TrashIcon size={14} color={RED} />
                </UnstyledButton>
              </Box>
            ),
          )}
        </Box>
      )}

      <Box style={{ display: 'flex', alignItems: 'flex-end', gap: 12, width: '100%' }}>
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <FieldLabel>{t('regions.name')}</FieldLabel>
          <TextInput
            placeholder={t('regions.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </Stack>
        <Stack gap={6} style={{ width: 150, flexShrink: 0 }}>
          <FieldLabel>{t('regions.code')}</FieldLabel>
          <TextInput
            placeholder={t('regions.codePlaceholder')}
            value={code}
            maxLength={16}
            onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
            styles={{ input: { fontFamily: MONO } }}
          />
        </Stack>
        <Action
          icon="plus"
          disabled={!name.trim() || !code.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate({ name: name.trim(), code: code.trim() })}
        >
          {t('regions.add')}
        </Action>
      </Box>
    </SectionCard>
  );
}

function RegionEditRow({
  region,
  loading,
  onSave,
  onCancel,
}: {
  region: Region;
  loading: boolean;
  onSave: (input: { name: string; code: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(region.name);
  const [code, setCode] = useState(region.code);
  return (
    <Box
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        borderRadius: 10,
        backgroundColor: WELL,
        border: `1px solid ${EDGE}`,
        minWidth: 0,
      }}
    >
      <TextInput
        style={{ width: 88, flexShrink: 0 }}
        value={code}
        maxLength={16}
        onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
        styles={{ input: { fontFamily: MONO, height: 30, minHeight: 30 } }}
      />
      <TextInput
        style={{ flex: 1, minWidth: 0 }}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        styles={{ input: { height: 30, minHeight: 30 } }}
      />
      <UnstyledButton
        type="button"
        title={t('common.save')}
        style={{ display: 'flex', flexShrink: 0, opacity: loading ? 0.5 : 1 }}
        onClick={() => onSave({ name: name.trim(), code: code.trim() })}
      >
        <TickIcon size={15} color={MOSS} />
      </UnstyledButton>
      <UnstyledButton type="button" title={t('common.cancel')} style={{ display: 'flex', flexShrink: 0 }} onClick={onCancel}>
        <CrossIcon size={15} color={MIST} />
      </UnstyledButton>
    </Box>
  );
}

/* ───── Two-factor ──────────────────────────────────────────────────────── */

function TwoFactorCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const statusQuery = useQuery({ queryKey: ['2fa-status'], queryFn: get2faStatus });
  const enabled = statusQuery.data?.enabled ?? false;

  const [setupData, setSetupData] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');

  const fail = (err: unknown) =>
    notifications.show({ color: 'red', title: t('common.saveError'), message: apiErrorMessage(err) });

  const setupMutation = useMutation({
    mutationFn: setup2fa,
    onSuccess: (d) => {
      setSetupData(d);
      setCode('');
    },
    onError: fail,
  });
  const enableMutation = useMutation({
    mutationFn: () => enable2fa(code),
    onSuccess: () => {
      setSetupData(null);
      setCode('');
      qc.invalidateQueries({ queryKey: ['2fa-status'] });
      notifications.show({ color: 'green', message: t('settings.twofa.enabledNotice') });
    },
    onError: fail,
  });
  const disableMutation = useMutation({
    mutationFn: () => disable2fa(code),
    onSuccess: () => {
      setCode('');
      qc.invalidateQueries({ queryKey: ['2fa-status'] });
      notifications.show({ color: 'green', message: t('settings.twofa.disabledNotice') });
    },
    onError: fail,
  });

  const codeValid = /^\d{6}$/.test(code);

  return (
    <SectionCard
      tone={enabled ? MOSS : AMBER}
      icon={<ShieldIcon size={16} color={enabled ? MOSS : AMBER} />}
      title={t('settings.twofa.title')}
      hint={t('settings.twofa.subtitle')}
      action={
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 22,
            paddingInline: 9,
            borderRadius: 6,
            flexShrink: 0,
            backgroundColor: enabled ? `${MOSS}14` : WELL,
            border: `1px solid ${enabled ? `${MOSS}2E` : EDGE}`,
          }}
        >
          <Box
            style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: enabled ? MOSS : DIM }}
          />
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: '0.1em',
              lineHeight: '12px',
              textTransform: 'uppercase',
              color: enabled ? MOSS : MIST,
            }}
          >
            {enabled ? t('settings.twofa.on') : t('settings.twofa.off')}
          </Text>
        </Box>
      }
    >
      <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '17px', color: MIST }}>
        {t('settings.twofa.desc')}
      </Text>

      {enabled ? (
        <Stack gap={6}>
          <FieldLabel>{t('settings.twofa.codeLabel')}</FieldLabel>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
            <TextInput
              style={{ flex: 1, minWidth: 0 }}
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
              styles={{ input: { fontFamily: MONO, letterSpacing: '0.3em' } }}
            />
            <Action
              tone={RED}
              disabled={!codeValid || disableMutation.isPending}
              onClick={() => disableMutation.mutate()}
            >
              {t('settings.twofa.disable')}
            </Action>
          </Box>
        </Stack>
      ) : setupData ? (
        <Stack gap={10}>
          <Hint>{t('settings.twofa.scanHint')}</Hint>
          <Secret label={t('settings.twofa.secretLabel')} value={setupData.secret} />
          <Secret label={t('settings.twofa.uriLabel')} value={setupData.uri} small />
          <Stack gap={6}>
            <FieldLabel>{t('settings.twofa.codeLabel')}</FieldLabel>
            <TextInput
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
              styles={{ input: { fontFamily: MONO, letterSpacing: '0.3em' } }}
            />
          </Stack>
          <Box style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Action onClick={() => setSetupData(null)}>{t('common.cancel')}</Action>
            <Action
              icon="tick"
              disabled={!codeValid || enableMutation.isPending}
              onClick={() => enableMutation.mutate()}
            >
              {t('settings.twofa.confirm')}
            </Action>
          </Box>
        </Stack>
      ) : (
        <Action icon="shield" disabled={setupMutation.isPending} onClick={() => setupMutation.mutate()}>
          {t('settings.twofa.enable')}
        </Action>
      )}
    </SectionCard>
  );
}

/** A value shown once, with the copy button beside it. */
function Secret({ label, value, small }: { label: string; value: string; small?: boolean }) {
  const { t } = useTranslation();
  return (
    <Stack gap={6}>
      <FieldLabel>{label}</FieldLabel>
      <Box
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 12px',
          borderRadius: 10,
          backgroundColor: WELL,
          border: `1px solid ${HAIRLINE}`,
        }}
      >
        <Text
          style={{
            fontFamily: MONO,
            fontSize: small ? 10 : 12,
            lineHeight: '16px',
            color: SNOW,
            flex: 1,
            minWidth: 0,
            wordBreak: 'break-all',
          }}
        >
          {value}
        </Text>
        <UnstyledButton
          type="button"
          title={t('common.copy')}
          style={{ display: 'flex', flexShrink: 0 }}
          onClick={() => copyToClipboard(value)}
        >
          <CopyIcon size={15} color={MIST} />
        </UnstyledButton>
      </Box>
    </Stack>
  );
}

/* ───── Recipe sources ──────────────────────────────────────────────────── */

function RecipeSourcesCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sourcesQuery = useQuery({ queryKey: ['recipe-sources'], queryFn: getRecipeSources });
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  // Bust both the source list and the merged registry so the picker updates.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['recipe-sources'] });
    qc.invalidateQueries({ queryKey: ['recipes'] });
  };
  const fail = (title: string) => (err: unknown) =>
    notifications.show({ color: 'red', title, message: apiErrorMessage(err) });

  const addMutation = useMutation({
    mutationFn: () => addRecipeSource({ name: name.trim(), url: url.trim() }),
    onSuccess: () => {
      invalidate();
      setName('');
      setUrl('');
      notifications.show({ color: 'green', message: t('settings.recipeSources.added') });
    },
    onError: fail(t('common.createError')),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateRecipeSource(id, { enabled }),
    onSuccess: invalidate,
    onError: fail(t('common.saveError')),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRecipeSource,
    onSuccess: () => {
      invalidate();
      notifications.show({ color: 'green', message: t('settings.recipeSources.deleted') });
    },
    onError: fail(t('common.deleteError')),
  });

  function confirmDelete(s: RecipeSource) {
    modals.openConfirmModal({
      title: t('settings.recipeSources.deleteTitle', { name: s.name }),
      children: <Text size="sm">{t('settings.recipeSources.deleteBody')}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(s.id),
    });
  }

  const sources = sourcesQuery.data?.sources ?? [];

  return (
    <SectionCard
      tone={MOSS}
      icon={<PackageIcon size={16} color={MOSS} />}
      title={t('settings.recipeSources.title')}
      hint={t('settings.recipeSources.description')}
    >
      {sources.length === 0 ? (
        <Hint>{t('settings.recipeSources.empty')}</Hint>
      ) : (
        <Stack gap={8}>
          {sources.map((s) => (
            <Box
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                backgroundColor: WELL,
                border: `1px solid ${HAIRLINE}`,
                width: '100%',
              }}
            >
              <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
                <Box style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <Text
                    style={{
                      fontFamily: DISPLAY,
                      fontSize: 13,
                      fontWeight: 500,
                      lineHeight: '17px',
                      color: s.enabled ? SNOW : MIST,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.name}
                  </Text>
                  {s.trusted && (
                    <Box
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 17,
                        paddingInline: 6,
                        borderRadius: 5,
                        flexShrink: 0,
                        backgroundColor: `${MOSS}14`,
                        border: `1px solid ${MOSS}2E`,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: MONO,
                          fontSize: 9,
                          letterSpacing: '0.08em',
                          lineHeight: '11px',
                          textTransform: 'uppercase',
                          color: MOSS,
                        }}
                      >
                        {t('recipes.registry.official')}
                      </Text>
                    </Box>
                  )}
                </Box>
                <Text
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    lineHeight: '14px',
                    color: FAINT,
                    wordBreak: 'break-all',
                  }}
                >
                  {s.url}
                </Text>
              </Stack>
              <Switch
                checked={s.enabled}
                onChange={(e) => toggleMutation.mutate({ id: s.id, enabled: e.currentTarget.checked })}
                style={{ flexShrink: 0 }}
              />
              <UnstyledButton
                type="button"
                title={t('common.delete')}
                style={{ display: 'flex', flexShrink: 0 }}
                onClick={() => confirmDelete(s)}
              >
                <TrashIcon size={15} color={RED} />
              </UnstyledButton>
            </Box>
          ))}
        </Stack>
      )}

      <Box style={{ display: 'flex', alignItems: 'flex-end', gap: 10, width: '100%' }}>
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <FieldLabel>{t('settings.recipeSources.nameLabel')}</FieldLabel>
          <TextInput
            placeholder={t('settings.recipeSources.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </Stack>
        <Stack gap={6} style={{ flex: 1.4, minWidth: 0 }}>
          <FieldLabel>{t('settings.recipeSources.urlLabel')}</FieldLabel>
          <TextInput
            placeholder="https://.../index.json"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            styles={{ input: { fontFamily: MONO, fontSize: 12 } }}
          />
        </Stack>
        <Action
          disabled={!name.trim() || !url.trim() || addMutation.isPending}
          onClick={() => addMutation.mutate()}
        >
          {t('settings.recipeSources.add')}
        </Action>
      </Box>

      <Hint>{t('settings.recipeSources.hint')}</Hint>
    </SectionCard>
  );
}

/* ───── Pieces ──────────────────────────────────────────────────────────── */

function SectionCard({
  tone,
  icon,
  title,
  hint,
  action,
  children,
}: {
  tone: string;
  icon: ReactNode;
  title: string;
  hint: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack
      gap={16}
      style={{ padding: 20, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
        <Box
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            backgroundColor: `${tone}1A`,
            border: `1px solid ${tone}33`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 14, fontWeight: 600, lineHeight: '18px', color: SNOW }}>
            {title}
          </Text>
          <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: MIST }}>{hint}</Text>
        </Stack>
        {action}
      </Box>
      {children}
    </Stack>
  );
}

function Action({
  children,
  icon,
  tone,
  disabled,
  onClick,
}: {
  children: ReactNode;
  icon?: 'plus' | 'tick' | 'shield';
  tone?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const accent = tone ?? CYAN;
  return (
    <UnstyledButton
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 36,
        paddingInline: 14,
        borderRadius: 8,
        backgroundColor: WELL,
        border: `1px solid ${tone ? `${tone}33` : HAIRLINE}`,
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {icon === 'plus' && <PlusIcon size={14} color={accent} />}
      {icon === 'tick' && <TickIcon size={14} color={accent} />}
      {icon === 'shield' && <ShieldIcon size={14} color={accent} />}
      <Text
        style={{
          fontFamily: DISPLAY,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: '16px',
          color: tone ?? SNOW,
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </Text>
    </UnstyledButton>
  );
}

function ColHead({ children, width, flex }: { children: ReactNode; width?: number; flex?: boolean }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: '0.12em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
        width,
        flex: flex ? 1 : undefined,
        minWidth: flex ? 0 : undefined,
        flexShrink: flex ? 1 : 0,
      }}
    >
      {children}
    </Text>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.12em',
        lineHeight: '12px',
        textTransform: 'uppercase',
        color: MIST,
      }}
    >
      {children}
    </Text>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>{children}</Text>
  );
}

function Fact({
  value,
  label,
  accent,
  soft,
}: {
  value: number;
  label: string;
  accent?: string;
  soft?: 'soft' | 'mid';
}) {
  return (
    <Box
      className={soft === 'soft' ? 'page-bar-fact-soft' : soft === 'mid' ? 'page-bar-fact-mid' : undefined}
      style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}
    >
      <Text
        style={{ fontFamily: MONO, fontSize: 15, fontWeight: 500, lineHeight: '18px', color: accent ?? SNOW }}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: '0.12em',
          lineHeight: '12px',
          textTransform: 'uppercase',
          color: MIST,
        }}
      >
        {label}
      </Text>
    </Box>
  );
}

function Dot({ soft }: { soft?: boolean | 'mid' }) {
  return (
    <Text
      className={soft === 'mid' ? 'page-bar-fact-mid' : soft ? 'page-bar-fact-soft' : undefined}
      style={{ fontFamily: MONO, fontSize: 10, lineHeight: '12px', color: DIM, flexShrink: 0 }}
    >
      ·
    </Text>
  );
}

/* ───── Formatting ──────────────────────────────────────────────────────── */

/** `12 Jun 2026`, short enough for a 110px column in either language. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** How long ago a token was last used, at the coarsest unit that still says
 *  something. */
function sinceLabel(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return t('settings.tokens.justNow');
  if (min < 60) return t('settings.tokens.minAgo', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('settings.tokens.hourAgo', { n: h });
  return t('settings.tokens.dayAgo', { n: Math.floor(h / 24) });
}

/* ───── Icons ───────────────────────────────────────────────────────────── */

function GearIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M10.3 3.6a1 1 0 0 1 1 -0.8h1.4a1 1 0 0 1 1 .8l.2 1.3a7 7 0 0 1 1.6 .9l1.2 -.5a1 1 0 0 1 1.2 .4l.7 1.2a1 1 0 0 1 -.2 1.3l-1 .8a7 7 0 0 1 0 1.9l1 .8a1 1 0 0 1 .2 1.3l-.7 1.2a1 1 0 0 1 -1.2 .4l-1.2 -.5a7 7 0 0 1 -1.6 .9l-.2 1.3a1 1 0 0 1 -1 .8h-1.4a1 1 0 0 1 -1 -.8l-.2 -1.3a7 7 0 0 1 -1.6 -.9l-1.2 .5a1 1 0 0 1 -1.2 -.4l-.7 -1.2a1 1 0 0 1 .2 -1.3l1 -.8a7 7 0 0 1 0 -1.9l-1 -.8a1 1 0 0 1 -.2 -1.3l.7 -1.2a1 1 0 0 1 1.2 -.4l1.2 .5a7 7 0 0 1 1.6 -.9z"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

function PaletteIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M12 3a9 9 0 1 0 0 18a2 2 0 0 0 1.6 -3.2a2 2 0 0 1 1.6 -3.2h1.8a4 4 0 0 0 4 -4c0 -4.1 -4 -7.6 -9 -7.6"
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="12" r="1.1" fill={color} />
      <circle cx="10" cy="8" r="1.1" fill={color} />
      <circle cx="14.5" cy="8.5" r="1.1" fill={color} />
    </svg>
  );
}

function KeyIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="15" r="4" fill="none" stroke={color} strokeWidth="1.8" />
      <path d="M10.85 12.15L19 4" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 5l2 2" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15 8l2 2" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ShieldIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2l4 -4"
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GlobeIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="1.7" />
      <path d="M3.5 9h17" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M3.5 15h17" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 3a13 13 0 0 1 0 18a13 13 0 0 1 0 -18" fill="none" stroke={color} strokeWidth="1.7" />
    </svg>
  );
}

function PackageIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M12 3l8 4.5v9L12 21l-8 -4.5v-9z"
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M4 7.5l8 4.5l8 -4.5" fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 12v9" fill="none" stroke={color} strokeWidth="1.7" />
    </svg>
  );
}

function InfoIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M12 9h.01" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M11 12h1v4h1"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function CopyIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke={color} strokeWidth="1.8" />
      <path
        d="M15 9v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v7a2 2 0 0 0 2 2h2"
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M4 7h16" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path
        d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2l1 -12"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 7v-2a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v2"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M4 20h4l10.5 -10.5a2.1 2.1 0 0 0 -3 -3L5 17v3"
        fill="none"
        stroke={color}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M12 5l0 14" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M5 12l14 0" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function TickIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path
        d="M5 12l5 5L20 7"
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path d="M6 6l12 12" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M18 6l-12 12" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
