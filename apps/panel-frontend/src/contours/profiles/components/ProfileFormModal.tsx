import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Card,
  Group,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBolt,
  IconDownload,
} from '@tabler/icons-react';
import {
  type CreateProfileInput,
  type Profile,
  type UpdateProfileInput,
} from '@/lib/domain/profiles';
import { RecipePicker } from '@/contours/profiles/components/RecipePicker';
import { RecipeExportModal } from '@/contours/profiles/components/RecipeExportModal';
import { ProfileRecipeExportModal } from '@/contours/profiles/components/ProfileRecipeExportModal';
import {
  resolveRecipeApply,
  RECIPE_COMMON_FIELDS,
} from '@/contours/profiles/lib/recipes';
import { protocolLabel } from '@/lib/domain/protocols';
import { useProfileForm } from '@/contours/profiles/components/ProfileForm/useProfileForm';
import type { FormValues, Mode } from '@/contours/profiles/lib/profileFormValues';
import { PROTOCOL_ACCENT, PROTOCOL_TILE_LABEL } from '@/contours/profiles/lib/protocolTiles';
import {
  PREVIEW_KINDS,
  PROFILE_KIND_BY_KEY,
  profileKindKey,
  type PreviewKindKey,
} from '@/contours/profiles/lib/profileKinds';
import {
  EMPTY_TELEGRAM_DRAFT,
  webDraftFromRecipe,
  webDraftRecipeValues,
  type TelegramDraft,
} from '@/contours/profiles/lib/telegramDraft';
import { isPlainSubprotocol } from '@/contours/profiles/lib/plainSubprotocol';
import { SINGBOX_XRAY_FORM_FIELD, singboxXrayPatch } from '@/contours/profiles/lib/xrayTransports';
import { singboxXrayMessage, type SingboxXrayRefusal } from '@/lib/domain/singboxXray';
import { EnginePicker } from '@/contours/profiles/components/ProfileForm/EnginePicker';
import { TelegramPreviewCard } from '@/contours/profiles/components/ProfileForm/TelegramPreview';
import { FormShell } from '@/contours/profiles/components/ProfileForm/FormShell';
import { SectionCard } from '@/contours/profiles/components/ProfileForm/SectionCard';
import { IdentitySection } from '@/contours/profiles/components/ProfileForm/IdentitySection';
import { XrayConfigWarnings } from '@/contours/profiles/components/ProfileForm/XrayConfigWarnings';
import { XraySection } from '@/contours/profiles/components/ProfileForm/XraySection';
import { HysteriaSection } from '@/contours/profiles/components/ProfileForm/HysteriaSection';
import { AmneziawgSection } from '@/contours/profiles/components/ProfileForm/AmneziawgSection';
import { NaiveSection } from '@/contours/profiles/components/ProfileForm/NaiveSection';
import { ShadowsocksSection } from '@/contours/profiles/components/ProfileForm/ShadowsocksSection';
import { MtprotoSection } from '@/contours/profiles/components/ProfileForm/MtprotoSection';
import { MieruSection } from '@/contours/profiles/components/ProfileForm/MieruSection';
import { TuicSection } from '@/contours/profiles/components/ProfileForm/TuicSection';
import { AnytlsSection } from '@/contours/profiles/components/ProfileForm/AnytlsSection';
import { ShadowtlsSection } from '@/contours/profiles/components/ProfileForm/ShadowtlsSection';

interface Props {
  opened: boolean;
  onClose: () => void;
  profile: Profile | null;
  /** Rejects when the save is refused, and reports the refusal itself: the
   *  form only stays open with the operator's values (see saveThen). */
  onSubmit: (input: CreateProfileInput | UpdateProfileInput, mode: Mode) => Promise<void>;
  loading?: boolean;
  /**
   * Render the form inline instead of inside a modal. The profile form is the
   * largest editor in the panel (protocol, transport, security, REALITY keys,
   * recipes), and a dialog is the wrong container for it: on a laptop it
   * scrolls inside a box while the page behind it sits empty. The page routes
   * use this; the modal path stays for the places not migrated yet.
   */
  inline?: boolean;
  /**
   * Raised while the operator is looking at a Telegram view the panel can draw
   * but not create yet. The page owns the primary action, so it has to hear
   * about it: a Create button that looks alive and then fails is worse than a
   * button that says plainly it cannot.
   */
  onPreviewChange?: (previewing: boolean) => void;
  /**
   * The server's sing-box refusal of the last save (singboxXrayRefusal). A
   * field of the profile itself is marked on its control; one in a binding's
   * overrides is not on this form, and the page's toast names it.
   */
  refused?: SingboxXrayRefusal | null;
}

export function ProfileFormModal({
  opened,
  onClose,
  profile,
  onSubmit,
  loading,
  inline,
  onPreviewChange,
  refused,
}: Props) {
  const { t } = useTranslation();
  const isEdit = profile !== null;
  const mode: Mode = isEdit ? 'edit' : 'create';
  const [exportOpen, exportCtl] = useDisclosure(false);
  const [advOpen, advCtl] = useDisclosure(false);
  // Kept beside the form, never inside it: a preview view has no name the API
  // would accept, so it must not be able to reach FormValues and from there a
  // request body.
  const [preview, setPreview] = useState<PreviewKindKey | null>(null);

  useEffect(() => {
    onPreviewChange?.(preview !== null);
  }, [preview, onPreviewChange]);

  const {
    form,
    keypairMutation,
    keypairPending,
    generateXrayKeys,
    generateAwgKeys,
    applyAwgPreset,
    handleSubmit,
  } = useProfileForm({ profile, opened, mode, onSubmit, onClose });
  // Changing the field clears the mark (clearInputErrorOnChange), and the next
  // submit's validation replaces it: the mark lives until the operator acts.
  // setFieldError is stable in @mantine/form, so only a new refusal marks.
  const { setFieldError } = form;
  useEffect(() => {
    if (!refused || refused.where !== 'config') return;
    setFieldError(SINGBOX_XRAY_FORM_FIELD[refused.field], singboxXrayMessage(refused, t));
  }, [refused, setFieldError, t]);
  // The tile the form is on: recipes are chosen by it, not by the protocol.
  const kindKey = profileKindKey(form.values.protocol, form.values.engine, form.values.xraySubprotocol);
  // The WEB card's draft: beside the form, never in it (TelegramPreviewCard).
  const [webDraft, setWebDraft] = useState<TelegramDraft>(EMPTY_TELEGRAM_DRAFT);
  const exportButton = (
    <UnstyledButton
      type="button"
      onClick={exportCtl.open}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 26,
        padding: '0 10px',
        borderRadius: 6,
        backgroundColor: '#0B1420',
        border: '1px solid #1C2A3D',
      }}
    >
      <IconDownload size={12} color="#7A8BA3" />
      <Text style={{ fontSize: 11, lineHeight: '14px', color: '#7A8BA3' }}>{t('recipes.export.button')}</Text>
    </UnstyledButton>
  );
  return (
    <FormShell
      inline={inline}
      opened={opened}
      onClose={() => {
        form.reset();
        onClose();
      }}
      title={
        <Group gap="sm" align="center">
          <Card
            p={8}
            radius="md"
            style={{
              backgroundColor: '#7DD3FC1A',
              border: '1px solid #7DD3FC33',
              color: '#7DD3FC',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconBolt size={18} />
          </Card>
          <Stack gap={2}>
            <Text style={{ fontFamily: "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontWeight: 500, fontSize: 18, color: '#C8D4E3' }}>
              {isEdit ? profile.name : t('modal.profileNewTitle')}
            </Text>
            <Text
              style={{
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                fontSize: 9,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#7A8BA3',
              }}
            >
              {isEdit ? t('modal.profileEditSubtitle') : t('modal.profileNewSubtitle')}
            </Text>
          </Stack>
        </Group>
      }
      size="lg"
    >
      <form
        id="profile-form"
        onSubmit={form.onSubmit((values) => {
          // Enter inside a text field submits the form too, so the preview
          // guard lives here and not only on the page's disabled button.
          // Without it the save would go through with whatever protocol was
          // selected before the operator opened the preview.
          if (preview) return undefined;
          return handleSubmit(values);
        })}
      >
        <Stack>
          {/* Which binary runs this profile, then which protocol that binary
              speaks. Two questions in the order they are actually answered,
              instead of one select holding thirteen mixed options. */}
          {inline && !isEdit && (
            <EnginePicker
              engine={form.values.engine}
              protocol={form.values.protocol}
              subprotocol={form.values.xraySubprotocol}
              preview={preview}
              onPick={(kind) => {
                setPreview(null);
                form.setFieldValue('engine', kind.engine);
                form.setFieldValue('protocol', kind.protocol);
                // SOCKS5 / HTTP are named by the subprotocol; leaving one of
                // them for another xray tile goes back to vless rather than
                // keeping a plain proxy under a REALITY tile.
                if (kind.subprotocol) form.setFieldValue('xraySubprotocol', kind.subprotocol);
                else if (isPlainSubprotocol(form.values.xraySubprotocol)) {
                  form.setFieldValue('xraySubprotocol', 'vless');
                }
                // The xray family on sing-box is REALITY steal-others over raw
                // only: a form coming from the xray tile with xhttp, TLS or
                // self-steal is brought back to that before the agent refuses.
                form.setValues(
                  singboxXrayPatch({ ...form.values, protocol: kind.protocol, engine: kind.engine }),
                );
              }}
              onPickPreview={setPreview}
            />
          )}

          <IdentitySection form={form} isEdit={isEdit} inline={inline} />

          {/* A saved profile exports as the server builds it (the registry's
              own field allowlist, random values as `randomize`). A profile not
              saved yet, and the WEB draft, export from the form: the draft
              under its recipe keys and without the secret. */}
          {isEdit && profile?.id && !preview ? (
            <ProfileRecipeExportModal opened={exportOpen} onClose={exportCtl.close} profileId={profile.id} />
          ) : (
            <RecipeExportModal
              opened={exportOpen}
              onClose={exportCtl.close}
              protocol={preview ?? form.values.protocol}
              values={
                preview
                  ? webDraftRecipeValues(webDraft.web)
                  : (form.values as unknown as Record<string, unknown>)
              }
            />
          )}

          {/* Recipes ride the right rail on the page (see index.css): they are
              a shortcut into the fields, not a step before them, so they sit
              alongside the form instead of pushing it down.

              Every tile has its rail, the WEB preview included (owner, 24.09).
              The built-ins are chosen by the TILE, not the protocol: SOCKS5
              does not get the REALITY recipes of vless, and hysteria on
              sing-box does not get its own daemon's. A WEB recipe fills the
              card's draft and never the form, so it cannot reach a save. */}
          <Box className="recipes-slot">
          {preview ? (
            <RecipePicker
              key={preview}
              kindKey={preview}
              kindLabel={PREVIEW_KINDS.find((p) => p.key === preview)?.label ?? preview}
              protocol={preview}
              onPick={(recipe) =>
                setWebDraft((d) => ({ ...d, web: webDraftFromRecipe(d.web, resolveRecipeApply(recipe)) }))
              }
            />
          ) : (
          <RecipePicker
            key={kindKey}
            kindKey={kindKey}
            kindLabel={PROTOCOL_TILE_LABEL[kindKey] ?? PROFILE_KIND_BY_KEY.get(kindKey)?.label ?? kindKey}
            protocol={form.values.protocol}
            onPick={async (recipe) => {
              // Resolve the recipe's field map. Built-ins may carry a thunk
              // (fresh randomness per click: Salamander password, AWG H1-H4,
              // REALITY+xhttp path); registry recipes carry a plain object plus
              // a declarative randomize list. resolveRecipeApply collapses both.
              // We then merge only keys that are real form fields, so an
              // imported recipe can never inject an unknown key into the form.
              const fields = resolveRecipeApply(recipe);
              form.setValues((current) => {
                const safe: Record<string, string | number | boolean> = {};
                for (const [k, v] of Object.entries(fields)) {
                  // Only protocol-specific fields: never let a recipe touch a
                  // common field (protocol/engine/name/description/enabled),
                  // even though they exist on the flat FormValues.
                  if (k in current && !RECIPE_COMMON_FIELDS.has(k)) safe[k] = v;
                }
                return { ...current, ...safe };
              });

              // Auto-fill missing crypto material so admin doesn't have to
              // chase 4 separate buttons (private key, public key, shortIds,
              // peer keys). Recipe = "I want this combo working" should mean
              // "form is ready to submit" after one click.
              // Not for SOCKS5 / HTTP: they have no REALITY to key.
              if (recipe.protocol === 'xray' && !isPlainSubprotocol(fields.xraySubprotocol ?? form.values.xraySubprotocol)) {
                const shortIdsEmpty = !form.values.xrayShortIds.trim();
                const keysEmpty = !form.values.xrayPrivateKey;
                const updates: Partial<FormValues> = {};

                if (shortIdsEmpty) {
                  // 6 random 16-hex-char shortIds - clients can pick any of
                  // them in their URI, REALITY accepts whichever matches.
                  // Multiple shortIds let admin rotate without breaking
                  // existing subscriptions.
                  updates.xrayShortIds = Array.from({ length: 6 }, () =>
                    Array.from({ length: 16 }, () =>
                      Math.floor(Math.random() * 16).toString(16),
                    ).join(''),
                  ).join(', ');
                }

                if (keysEmpty) {
                  try {
                    const kp = await keypairMutation.mutateAsync('xray');
                    updates.xrayPrivateKey = kp.privateKey;
                    updates.xrayPublicKey = kp.publicKey;
                  } catch {
                    // Soft-fail - admin can still hit "Сгенерировать" manually.
                  }
                }

                if (Object.keys(updates).length > 0) {
                  form.setValues((current) => ({ ...current, ...updates }));
                }
              }

              if (recipe.protocol === 'amneziawg' && !form.values.awgServerPriv) {
                try {
                  const kp = await keypairMutation.mutateAsync('amneziawg');
                  form.setValues((current) => ({
                    ...current,
                    awgServerPriv: kp.privateKey,
                    awgServerPub: kp.publicKey,
                  }));
                } catch {
                  /* soft-fail */
                }
              }
            }}
          />
          )}
          </Box>

          {preview ? (
            <TelegramPreviewCard kind={preview} draft={webDraft} onDraft={setWebDraft} action={exportButton} />
          ) : (
          <SectionCard
            title={t('profiles.form.cfg.configTitle', {
              protocol: protocolLabel(form.values.protocol),
            })}
            accent={PROTOCOL_ACCENT[form.values.protocol] ?? '#A78BFA'}
            icon={
              <IconBolt
                size={15}
                color={PROTOCOL_ACCENT[form.values.protocol] ?? '#A78BFA'}
                stroke={1.8}
              />
            }
            action={exportButton}
          >
          {/* The warnings are about Vision, REALITY and transports, none of
              which a SOCKS5 or HTTP profile has. */}
          {form.values.protocol === 'xray' && !isPlainSubprotocol(form.values.xraySubprotocol) && (
            <XrayConfigWarnings form={form} />
          )}

          {form.values.protocol === 'hysteria' && <HysteriaSection form={form} />}

          {form.values.protocol === 'xray' && (
            <XraySection
              form={form}
              advOpen={advOpen}
              advCtl={advCtl}
              generateXrayKeys={generateXrayKeys}
              keypairPending={keypairPending}
              profileId={profile?.id ?? null}
            />
          )}

          {form.values.protocol === 'amneziawg' && (
            <AmneziawgSection
              form={form}
              isEdit={isEdit}
              generateAwgKeys={generateAwgKeys}
              applyAwgPreset={applyAwgPreset}
              keypairPending={keypairPending}
              profileId={profile?.id ?? null}
            />
          )}

          {form.values.protocol === 'naive' && <NaiveSection form={form} />}

          {form.values.protocol === 'shadowsocks' && <ShadowsocksSection form={form} />}

          {form.values.protocol === 'mtproto' && <MtprotoSection form={form} />}

          {form.values.protocol === 'mieru' && <MieruSection form={form} />}

          {form.values.protocol === 'tuic' && <TuicSection form={form} />}

          {form.values.protocol === 'anytls' && <AnytlsSection form={form} />}

          {form.values.protocol === 'shadowtls' && <ShadowtlsSection form={form} />}
          </SectionCard>
          )}

          {/* Inline mode has Cancel and Save in the page bar already; a second
              pair at the end of a long form is just noise. */}
          {!inline && (
          <Group justify="space-between" gap="sm">
            <Text
              style={{
                fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace",
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: '#7A8BA3',
              }}
            >
              {isEdit ? t('modal.shortcutSave') : t('modal.shortcutCreate')}
            </Text>
            <Group gap="sm">
              <Button variant="default" onClick={onClose} disabled={loading}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                style={{ backgroundColor: '#2A93D1', color: '#08101A', fontWeight: 500 }}
              >
                {isEdit ? t('profiles.form.submitEdit') : t('profiles.form.submitCreate')}
              </Button>
            </Group>
          </Group>
          )}
        </Stack>
      </form>
    </FormShell>
  );
}

/**
 * Engine tabs plus protocol tiles, the way the artboard frames the choice: the
 * tab decides which binary runs on the node, the tile decides what it speaks.
 * A protocol served by two engines (xray, hysteria, shadowsocks) appears under
 * both, which is exactly the fact the old single select hid.
 */



