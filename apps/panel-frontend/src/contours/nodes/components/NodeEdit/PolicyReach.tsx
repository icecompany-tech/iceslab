import { useTranslation } from 'react-i18next';
import { Box, Stack, Text } from '@mantine/core';
import type { NodeCore } from '@/lib/domain/nodes';
import { AMBER, MIST, MONO, RED, SNOW } from '@/contours/nodes/lib/colors';

/**
 * Who on this node the policy actually reaches.
 *
 * Rendering an operator policy is the job of a CORE, not of a node: one adapter
 * writes the rules into its own config and the others do not, so a machine
 * running two cores can put half its users under the policy and leave the other
 * half outside it. The picker above says which policy is chosen; this says whom
 * it will hold for, which is the part the operator is actually asking about
 * when they set a rule that blocks something.
 *
 * FOUR states, and the fourth is not a rounding of the third:
 *
 *   every core      one grey line naming the cores. Quiet, but said out loud,
 *                   because this is where the operator learns that coverage is
 *                   a per-core fact at all.
 *   some cores      amber, naming both sides. The half that walks around the
 *                   rule is the sentence that matters.
 *   no core         red. The policy still saves, and the panel says exactly
 *                   that: saved, and without effect on this machine.
 *   not known       grey, and it claims nothing. `rendersPolicy` is ABSENT on
 *                   an agent older than the field, which is not `false`:
 *                   telling an operator the policy is ignored on a core that
 *                   applies it is worse than saying nothing, and it is the
 *                   mistake this whole screen exists to avoid.
 *
 * Nothing at all is drawn while the node has never reported (`cores` null).
 */
export function PolicyReach({
  cores,
  hasPolicy,
}: {
  cores: NodeCore[] | undefined;
  hasPolicy: boolean;
}) {
  const { t } = useTranslation();
  if (!cores || cores.length === 0) return null;

  const name = (c: NodeCore) => (c.engine && c.engine !== c.name ? `${c.name} (${c.engine})` : c.name);
  const applied = cores.filter((c) => c.rendersPolicy === true).map(name);
  const missing = cores.filter((c) => c.rendersPolicy === false).map(name);
  const unknown = cores.filter((c) => c.rendersPolicy === undefined).map(name);
  const list = (names: string[]) => names.join(', ');

  // Nothing to say yet: every core came from an agent that does not report the
  // field. One grey line, so the silence is legible rather than an empty card.
  if (applied.length === 0 && missing.length === 0) {
    return (
      <Text style={{ fontSize: 12, lineHeight: '17px', color: MIST }}>
        {t('nodeEdit.policyReachUnknown', { cores: list(unknown) })}
      </Text>
    );
  }

  // Every core that answered carries it, and nobody said otherwise.
  if (missing.length === 0) {
    return (
      <Stack gap={4}>
        <Text style={{ fontSize: 12, lineHeight: '17px', color: MIST }}>
          {t('nodeEdit.policyReachAll', { cores: list(applied) })}
        </Text>
        {unknown.length > 0 && (
          <Text style={{ fontSize: 12, lineHeight: '17px', color: MIST }}>
            {t('nodeEdit.policyReachSomeUnknown', { cores: list(unknown) })}
          </Text>
        )}
      </Stack>
    );
  }

  const none = applied.length === 0;
  const tone = none ? RED : AMBER;

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: '100%',
        padding: '14px 16px',
        borderRadius: 10,
        backgroundColor: `${tone}0F`,
        border: `1px solid ${tone}33`,
      }}
    >
      <Box style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%' }}>
        <Box style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: tone, flexShrink: 0 }} />
        <Text style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.14em', color: tone }}>
          {none ? t('nodeEdit.policyReachNoneTag') : t('nodeEdit.policyReachSomeTag')}
        </Text>
      </Box>

      <Stack gap={4}>
        <Text style={{ fontSize: 13, lineHeight: '19px', color: SNOW }}>
          {none
            ? t('nodeEdit.policyReachNone', { cores: list(missing) })
            : t('nodeEdit.policyReachSome', { applied: list(applied), missing: list(missing) })}
        </Text>
        {/* A core that never answered is listed apart from the ones that said
            no. Folding it into either side would invent an answer. */}
        {unknown.length > 0 && (
          <Text style={{ fontSize: 12, lineHeight: '17px', color: MIST }}>
            {t('nodeEdit.policyReachSomeUnknown', { cores: list(unknown) })}
          </Text>
        )}
        {/* Said every time the reach is partial, and not only when a policy is
            already chosen: an operator about to pick one needs it first. */}
        <Text style={{ fontSize: 12, lineHeight: '17px', color: MIST }}>
          {hasPolicy ? t('nodeEdit.policyReachHintSet') : t('nodeEdit.policyReachHint')}
        </Text>
      </Stack>
    </Box>
  );
}
