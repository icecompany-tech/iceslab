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
import {
  resolveRecipeApply,
  RECIPE_COMMON_FIELDS,
} from '@/contours/profiles/lib/recipes';
import { protocolLabel } from '@/lib/domain/protocols';
import { useProfileForm } from '@/contours/profiles/components/ProfileForm/useProfileForm';
import type { FormValues, Mode } from '@/contours/profiles/lib/profileFormValues';
import { PROTOCOL_ACCENT } from '@/contours/profiles/lib/protocolTiles';
import type { PreviewKindKey } from '@/contours/profiles/lib/profileKinds';
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
}

export function ProfileFormModal({
  opened,
  onClose,
  profile,
  onSubmit,
  loading,
  inline,
  onPreviewChange,
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
              preview={preview}
              onPick={(kind) => {
                setPreview(null);
                form.setFieldValue('engine', kind.engine);
                form.setFieldValue('protocol', kind.protocol);
              }}
              onPickPreview={setPreview}
            />
          )}

          <IdentitySection form={form} isEdit={isEdit} inline={inline} />

          <RecipeExportModal
            opened={exportOpen}
            onClose={exportCtl.close}
            protocol={form.values.protocol}
            values={form.values as unknown as Record<string, unknown>}
          />

          {/* Recipes ride the right rail on the page (see index.css): they are
              a shortcut into the fields, not a step before them, so they sit
              alongside the form instead of pushing it down.

              A preview view has no recipes and no protocol the registry would
              answer for, so the rail steps aside rather than showing the ones
              belonging to whatever was selected before. */}
          {!preview && (
          <Box className="recipes-slot">
          <RecipePicker
            key={form.values.protocol}
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
              if (recipe.protocol === 'xray') {
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
          </Box>
          )}

          {preview ? (
            <TelegramPreviewCard kind={preview} />
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
            action={
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
                <Text style={{ fontSize: 11, lineHeight: '14px', color: '#7A8BA3' }}>
                  {t('recipes.export.button')}
                </Text>
              </UnstyledButton>
            }
          >
          {form.values.protocol === 'xray' && <XrayConfigWarnings form={form} />}

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



