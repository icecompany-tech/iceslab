import { useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '@/lib/net/client';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import { generateInboundKeypair } from '@/lib/domain/inbounds';
import type {
  CreateProfileInput,
  Profile,
  UpdateProfileInput,
} from '@/lib/domain/profiles';
import { renameAwg, type FormValues, type Mode } from '@/contours/profiles/lib/profileFormValues';
import { profileConfigOf } from '@/contours/profiles/lib/profileConfig';
import { defaults } from '@/contours/profiles/lib/profileDefaults';
import { MOBILE_PRESET, randomAwgHeaders, TSPU_PRESET } from '@/contours/profiles/lib/awgPresets';
import { settleXrayFields, xrayFieldReactions } from '@/contours/profiles/lib/xrayFieldReactions';
import { ENGINE_CHOICE_PROTOCOLS } from '@/contours/profiles/lib/profileKinds';
import { saveThen } from '@/contours/profiles/lib/saveThen';
import { profileAwgCreate, profileAwgPatch } from '@/lib/domain/awg';
import { ssConfigPatch } from '@/contours/profiles/lib/ssServerKey';
import { portHopProblem, portHopWords, type PortHopField } from '@/contours/profiles/lib/portHopRange';
import { awgHeaderProblems, type AwgHField } from '@/contours/profiles/lib/awgHeaders';

/**
 * Everything the profile form owns that is not markup: the Mantine form, the
 * effects that keep dependent fields honest, the keypair mutation and the
 * submit that shapes the API payload. The modal keeps only layout.
 */
export function useProfileForm({
  profile,
  opened,
  mode,
  onSubmit,
  onClose,
}: {
  profile: Profile | null;
  opened: boolean;
  mode: Mode;
  onSubmit: (input: CreateProfileInput | UpdateProfileInput, mode: Mode) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = profile !== null;

  const form = useForm<FormValues>({
    initialValues: settleXrayFields(defaults(profile)),
    // Транспорт и подпротокол xray тянут за собой соседние поля
    // (xrayFieldReactions): на любую смену значения, правкой поля, рецептом
    // или засевом, а не эффектом после рендера.
    onValuesChange: (values, previous) => {
      const patch = xrayFieldReactions(values, previous);
      if (patch) form.setValues(patch);
    },
    validate: {
      name: (v) => {
        if (v.length < 1) return 'Required';
        // Mirror backend Zod regex - Letters, digits, dot, underscore, hyphen
        // (no spaces, no Cyrillic). Catch the violation client-side so the
        // admin doesn't ride a 400 round-trip to find out.
        if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
          return t('profileForm.nameLatinOnly');
        }
        return null;
      },
      // Both bounds or neither, the end above the start (A-284): the words
      // the server's refusal on the same field gets.
      hyPortHopStart: (_v, values) => portHopError(values, 'hyPortHopStart'),
      hyPortHopEnd: (_v, values) => portHopError(values, 'hyPortHopEnd'),
      // H1..H4 above 4 and distinct (A-286), before the request and on the
      // field, in the words under the fields.
      awgH1: (_v, values) => awgHError(values, 'awgH1'),
      awgH2: (_v, values) => awgHError(values, 'awgH2'),
      awgH3: (_v, values) => awgHError(values, 'awgH3'),
      awgH4: (_v, values) => awgHError(values, 'awgH4'),
    },
  });

  function awgHError(values: FormValues, field: AwgHField): string | null {
    if (values.protocol !== 'amneziawg') return null;
    return awgHeaderProblems(values).has(field) ? t('profiles.form.cfg.awgHDesc') : null;
  }

  function portHopError(values: FormValues, field: PortHopField): string | null {
    if (values.protocol !== 'hysteria') return null;
    return portHopProblem(values.hyPortHopStart, values.hyPortHopEnd) === field ? portHopWords(field, t) : null;
  }

  // Засев при открытии и при смене профиля, но не при новом объекте того же
  // профиля: refetch списка приносит новый объект с тем же id, и пересев
  // стёр бы несохранённые правки. useEffectEvent читает свежий profile, а
  // эффект зависит только от того, что должно пересевать.
  const seed = useEffectEvent(() => form.setValues(settleXrayFields(defaults(profile))));
  useEffect(() => {
    if (opened) seed();
  }, [opened, profile?.id]);

  const keypairMutation = useMutation({
    mutationFn: (protocol: 'xray' | 'amneziawg') => generateInboundKeypair(protocol),
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.error'),
        // The server's words, not axios's (A-227).
        message: apiErrorMessage(err),
      }),
  });

  async function generateXrayKeys() {
    const kp = await keypairMutation.mutateAsync('xray');
    form.setValues({ ...form.values, xrayPrivateKey: kp.privateKey, xrayPublicKey: kp.publicKey });
    notifications.show({ color: 'green', message: 'REALITY keypair generated' });
  }

  async function generateAwgKeys() {
    const kp = await keypairMutation.mutateAsync('amneziawg');
    form.setValues({ ...form.values, awgServerPriv: kp.privateKey, awgServerPub: kp.publicKey });
    notifications.show({ color: 'green', message: 'AmneziaWG server keypair generated' });
  }

  function applyAwgPreset(preset: 'tspu' | 'mobile' | 'custom') {
    form.setFieldValue('awgPreset', preset);
    // Always re-roll H1-H4 on preset apply - each profile should have unique
    // headers so it's not fingerprinted as "another Iceslab TSPU node".
    const headers = randomAwgHeaders();
    if (preset === 'tspu') {
      form.setValues({
        ...form.values,
        awgPreset: preset,
        ...renameAwg(TSPU_PRESET),
        awgH1: headers.h1,
        awgH2: headers.h2,
        awgH3: headers.h3,
        awgH4: headers.h4,
      });
    } else if (preset === 'mobile') {
      form.setValues({
        ...form.values,
        awgPreset: preset,
        ...renameAwg(MOBILE_PRESET),
        awgH1: headers.h1,
        awgH2: headers.h2,
        awgH3: headers.h3,
        awgH4: headers.h4,
      });
    } else {
      // custom - only re-roll headers if all 4 are blank, so admin's manual
      // tweaks aren't clobbered by accident.
      const allEmpty =
        form.values.awgH1 === '' &&
        form.values.awgH2 === '' &&
        form.values.awgH3 === '' &&
        form.values.awgH4 === '';
      if (allEmpty) {
        form.setValues({
          ...form.values,
          awgPreset: preset,
          awgH1: headers.h1,
          awgH2: headers.h2,
          awgH3: headers.h3,
          awgH4: headers.h4,
        });
      }
    }
  }

  async function handleSubmit(values: FormValues) {
    // Shadowsocks: the real payload is ssConfigPatch below; this is only the
    // create shape.
    const config = profileConfigOf(values);

    // Engine-choice: only the shared protocols carry a non-native engine;
    // everything else stays null (native). A 'native' selection -> null.
    const engine: 'singbox' | null =
      ENGINE_CHOICE_PROTOCOLS.includes(values.protocol) && values.engine === 'singbox'
        ? 'singbox'
        : null;

    // Поколение AWG (227054e): в PUT только при смене, в POST только 3.
    const isAwg = values.protocol === 'amneziawg';
    // Shadowsocks: an edit that keeps the cipher sends no config, so the
    // server key it cannot show is not erased (A-028).
    const configPart =
      values.protocol === 'shadowsocks'
        ? ssConfigPatch(profile?.config, isEdit, values.ssMethod)
        : { config };
    const input: CreateProfileInput | UpdateProfileInput = isEdit
      ? {
          name: values.name,
          description: values.description.trim() || null,
          enabled: values.enabled,
          engine,
          ...(configPart as { config?: never }),
          ...(isAwg ? profileAwgPatch(profile.awgProtocol, values.awgGeneration) : {}),
        }
      : {
          protocol: values.protocol,
          name: values.name,
          description: values.description.trim() || null,
          enabled: values.enabled,
          engine,
          config: config as never,
          ...(isAwg ? profileAwgCreate(values.awgGeneration) : {}),
        };
    // A refusal is reported by the caller; the form stays open and keeps
    // what was typed, and nothing is thrown past it.
    await saveThen(
      () => onSubmit(input, mode),
      () => {
        onClose();
        form.reset();
      },
    );
  }


  return {
    form,
    // The recipe apply handler in the modal drives the mutation directly, so it
    // gets the mutation itself; sections only need the pending flag.
    keypairMutation,
    keypairPending: keypairMutation.isPending,
    generateXrayKeys,
    generateAwgKeys,
    applyAwgPreset,
    handleSubmit,
  };
}
