import { useTranslation } from 'react-i18next';
import { Box, Stack, Text } from '@mantine/core';
import type { NodeCore } from '@/lib/domain/nodes';
import { AMBER, MIST, MONO, RED, SNOW } from '@/contours/nodes/lib/colors';

/**
 * Who on this node the policy actually reaches.
 *
 * Applying an operator policy is the job of a CORE, not of a node: one adapter
 * writes the rules into its own config and the others do not, so a machine
 * running two cores can put half its users under the policy and leave the other
 * half outside it. The picker above says which policy is chosen; this says whom
 * it will hold for, which is the part the operator is actually asking about
 * when they set a rule that blocks something.
 *
 * Three states, and none of them is a badge in a corner:
 *
 *   every core      one grey line naming the cores. Quiet, but said out loud,
 *                   because this is where the operator learns that coverage is
 *                   a per-core fact at all.
 *   some cores      amber, naming both sides: who is under the rule and who
 *                   walks around it. The half that walks around it is the
 *                   sentence that matters.
 *   no core         red. The policy still saves, and the panel says exactly
 *                   that: saved, and without effect on this machine.
 *
 * Nothing is drawn while `cores` is undefined. Today that is every node: the
 * field is not in the API yet. A card that guessed from `protocol` would be
 * confidently wrong the first time somebody registers a new adapter, and wrong
 * in the direction that costs an address.
 */
export function PolicyReach({ cores, hasPolicy }: { cores: NodeCore[] | undefined; hasPolicy: boolean }) {
  const { t } = useTranslation();
  if (!cores || cores.length === 0) return null;

  const applied = cores.filter((c) => c.appliesPolicy).map((c) => c.core);
  const missing = cores.filter((c) => !c.appliesPolicy).map((c) => c.core);
  const list = (names: string[]) => names.join(', ');

  // Every core carries it: one line, no box, no colour.
  if (missing.length === 0) {
    return (
      <Text style={{ fontSize: 12, lineHeight: '17px', color: MIST }}>
        {t('nodeEdit.policyReachAll', { cores: list(applied) })}
      </Text>
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
        {/* Said every time the reach is partial, and not only when a policy is
            already chosen: an operator about to pick one needs it first. */}
        <Text style={{ fontSize: 12, lineHeight: '17px', color: MIST }}>
          {hasPolicy ? t('nodeEdit.policyReachHintSet') : t('nodeEdit.policyReachHint')}
        </Text>
      </Stack>
    </Box>
  );
}
