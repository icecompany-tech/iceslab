import { AMBER, CARD, CYAN, DIM, DISPLAY, EDGE, FAINT, HAIRLINE, MIST, MONO, RED, SNOW, WELL } from '@/contours/traffic/lib/colors';
import { Action } from '@/contours/traffic/components/RoutePolicy/Action';
import { Chip } from '@/contours/traffic/components/RoutePolicy/Chip';
import { ColHead } from '@/contours/traffic/components/RoutePolicy/ColHead';
import { IconAction } from '@/contours/traffic/components/RoutePolicy/IconAction';
import { LockIcon, NoEntryIcon, TrashIcon, WarnIcon } from '@/contours/traffic/components/RoutePolicy/icons';
import { NEW_POLICY_ID } from '@/contours/traffic/lib/routeRules';
import { RulesList } from '@/contours/traffic/components/RoutePolicy/RulesList';
import { useRoutePolicyForm } from '@/contours/traffic/components/RoutePolicy/useRoutePolicyForm';
import { useTranslation } from 'react-i18next';
import { Box, Stack, Text, TextInput } from '@mantine/core';
import { ROUTE_POLICY_WRITES_LIVE, type RoutePolicy } from '@/lib/domain/routePolicies';
import { type Squad } from '@/lib/domain/squads';

/**
 * The "on the node" editor: a policy's rules in the order they are evaluated.
 *
 * Traffic has already reached us here, so every rule decides which door it
 * leaves by. The first and last rows are not rules and cannot be moved: the
 * panel always puts its own hygiene rules first, and whatever matched nothing
 * has to leave somewhere.
 *
 * The rule model (ordered, four actions, per-rule note) is what the design
 * needs and what `RoutePolicyInput` describes. The API stores two flat domain
 * arrays and has no write route yet, so a policy loaded today is DERIVED from
 * those arrays and Save reports the 404 rather than pretending. Everything
 * else on this screen is live.
 */

export function RoutePolicyEditor({
  policy,
  squads,
  onCreated,
}: {
  policy: RoutePolicy;
  squads: Squad[];
  onCreated?: () => void;
}) {
  const { t } = useTranslation();
  const {
    dirty,
    shadows,
    saveMutation,
    setRule,
    addRule,
    removeRule,
    move,
    confirmDelete,
    name,
    setName,
    rules,
    dragging,
    setDragging,
  } = useRoutePolicyForm(policy, squads, onCreated);

  return (
    <Stack gap={0} className="routes-detail">
      {/* Header: the name is the field, because renaming is an edit like any
          other and a policy has nowhere else to be renamed. */}
      <Box style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', width: '100%' }}>
        <TextInput
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={t('routes.policyNamePlaceholder')}
          styles={{
            input: {
              fontFamily: DISPLAY,
              fontSize: 17,
              fontWeight: 600,
              height: 32,
              minHeight: 32,
              paddingInline: 10,
              backgroundColor: 'transparent',
              borderColor: 'transparent',
              color: SNOW,
            },
          }}
          style={{ width: 260, flexShrink: 0 }}
        />
        {/* The band, read-only on purpose. It rides inside every subscriber's
            UUID, so moving it would reroute everyone already holding a link.
            The API assigns it and refuses to change it. */}
        {policy.id !== NEW_POLICY_ID && (
          <Box title={t('routes.bandFixed')}>
            <Chip tone={CYAN}>{t('routes.tag', { n: policy.ordinal })}</Chip>
          </Box>
        )}
        {dirty && <Chip tone={AMBER}>{t('routes.unsaved')}</Chip>}
        <Box style={{ flex: 1, minWidth: 0 }} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '15px', color: FAINT }}>
          {t('routes.firstMatchWins')}
        </Text>
        {policy.id !== NEW_POLICY_ID && ROUTE_POLICY_WRITES_LIVE && (
          <IconAction title={t('common.delete')} onClick={confirmDelete}>
            <TrashIcon size={15} color={RED} />
          </IconAction>
        )}
        <Action
          disabled={!ROUTE_POLICY_WRITES_LIVE || !dirty || saveMutation.isPending}
          // Saving is not a local edit: the API re-pushes the config to every
          // enabled cascade entry, so it reaches live machines immediately.
          title={ROUTE_POLICY_WRITES_LIVE ? t('routes.saveReachesNodes') : t('routes.writesDisabledPolicies')}
          onClick={() => saveMutation.mutate()}
        >
          {t('common.save')}
        </Action>
      </Box>

      {/* Columns */}
      <Box
        className="routes-rule"
        style={{
          paddingBlock: 9,
          paddingInline: 20,
          backgroundColor: WELL,
          borderTop: `1px solid ${HAIRLINE}`,
          borderBottom: `1px solid ${HAIRLINE}`,
        }}
      >
        <Box style={{ width: 22, flexShrink: 0 }} />
        <ColHead className="routes-rule-match">{t('routes.colMatch')}</ColHead>
        <ColHead className="routes-rule-action">{t('routes.colSend')}</ColHead>
        <ColHead flex>{t('routes.colNote')}</ColHead>
      </Box>

      {/* The panel's own hygiene rules. Not editable and not a lie: they are
          emitted ahead of everything an operator writes. */}
      <Box
        className="routes-rule"
        style={{ paddingBlock: 12, paddingInline: 20, borderLeft: `3px solid ${RED}` }}
      >
        <Box style={{ width: 22, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          <LockIcon size={12} color={FAINT} />
        </Box>
        <Text
          className="routes-rule-match"
          style={{ fontFamily: MONO, fontSize: 12, lineHeight: '16px', color: MIST }}
        >
          {t('routes.hygieneMatch')}
        </Text>
        <Text
          className="routes-rule-action"
          style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '16px', color: MIST }}
        >
          {t('routes.hygieneAction')}
        </Text>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, flex: 1, minWidth: 0 }}>
          {t('routes.hygieneNote')}
        </Text>
      </Box>

      <RulesList shadows={shadows} setRule={setRule} addRule={addRule} removeRule={removeRule} move={move} rules={rules} dragging={dragging} setDragging={setDragging} />

      {/* The row that always exists and always has a value. */}
      <Box
        className="routes-rule"
        style={{ paddingBlock: 14, paddingInline: 20, backgroundColor: WELL, borderTop: `1px solid ${HAIRLINE}` }}
      >
        <Box style={{ width: 22, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          <NoEntryIcon size={13} color={DIM} />
        </Box>
        <Text
          className="routes-rule-match"
          style={{
            fontFamily: DISPLAY,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: '16px',
            color: SNOW,
          }}
        >
          {t('routes.everythingElse')}
        </Text>
        <Box
          className="routes-rule-action"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            height: 32,
            paddingInline: 10,
            borderRadius: 7,
            backgroundColor: CARD,
            border: `1px solid ${EDGE}`,
          }}
        >
          <Box style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: CYAN, flexShrink: 0 }} />
          <Text style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: '16px', color: SNOW }}>
            {t('routes.nodeDoor')}
          </Text>
        </Box>
        <Text style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: FAINT, flex: 1, minWidth: 0 }}>
          {t('routes.nodeDoorNote')}
        </Text>
      </Box>

      {/* One line, always true today, and one line to delete when it stops
          being true. */}
      <Box
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          padding: '12px 20px',
          borderTop: `1px solid ${HAIRLINE}`,
          backgroundColor: `${AMBER}0A`,
        }}
      >
        <WarnIcon size={13} color={AMBER} />
        <Text style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: '16px', color: AMBER, flex: 1 }}>
          {t('routes.writesNotLive')}
        </Text>
      </Box>
    </Stack>
  );
}

/** The id a policy that does not exist yet carries. */

