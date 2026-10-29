import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Box, Loader, Select, Stack, Text, UnstyledButton } from '@mantine/core';
import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_TARGET_KINDS, type AdminAuditEventDto, type AdminAuditTargetKind } from '@iceslab/shared';
import { auditRefusal, listAudit } from '@/lib/domain/audit';
import { apiErrorMessage } from '@/lib/net/client';
import { loadView } from '@/lib/ui/loadView';
import { LoadFailed } from '@/ui/LoadFailed';
import { AMBER, CARD, CYAN, EDGE, FAINT, HAIRLINE, MIST, MOSS, RED, ROW, SNOW, WELL } from '@/lib/ui/tokens';
import {
  ACTION_GROUPS,
  actionFilterParam,
  actionKey,
  actionWords,
  actorWords,
  detailLines,
  groupKey,
  outcomeWords,
  periodFrom,
  targetKey,
  targetWords,
} from '@/contours/audit/lib/auditWords';

/**
 * «Журнал действий»: who did what in the panel, on which object, and how it
 * ended (GET /api/audit, shared/audit.ts). Newest first, a page at a time by
 * the server's cursor. A row opens into its detail, read by the action's own
 * fields (auditWords.detailLines).
 *
 * The filter is the server's: an empty page under a filter says «nothing for
 * this filter», not «the log is empty».
 */

const DISPLAY = "'Inter Variable', Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO = "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace";
const PAGE = 50;
const PERIODS = [
  { days: 1, key: 'audit.period.day' },
  { days: 7, key: 'audit.period.week' },
  { days: 30, key: 'audit.period.month' },
  { days: null, key: 'audit.period.all' },
] as const;
const COLUMNS = '170px 180px minmax(0, 1.2fr) minmax(0, 1fr) 150px';

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const [action, setAction] = useState('');
  const [targetKind, setTargetKind] = useState<AdminAuditTargetKind | ''>('');
  // The moment is fixed when the period is picked: computed on render it would
  // change the query's key on every render and refetch for ever.
  const [period, setPeriod] = useState<{ days: number | null; from: string | undefined }>({ days: 7, from: periodFrom(7, new Date()) });
  // Several rows open at once: the log is read by comparing them.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const filters = { action: actionFilterParam(action), targetKind: targetKind || undefined, from: period.from };
  const filtered = Boolean(filters.action || filters.targetKind || filters.from);
  const query = useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => listAudit({ ...filters, limit: PAGE, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const view = loadView(query);
  const events: AdminAuditEventDto[] = query.data?.pages.flatMap((p) => p.events) ?? [];
  const refusal = auditRefusal(query.error);

  const actionData = [
    { value: '', label: t('audit.filter.allActions') },
    {
      group: t('audit.filter.groups'),
      items: ACTION_GROUPS.map((g) => ({ value: `group:${g}`, label: t('audit.filter.groupOf', { group: t(groupKey(g)) }) })),
    },
    { group: t('audit.filter.actions'), items: ADMIN_AUDIT_ACTIONS.map((a) => ({ value: a, label: t(actionKey(a)) })) },
  ];
  const targetData = [
    { value: '', label: t('audit.filter.allTargets') },
    ...ADMIN_AUDIT_TARGET_KINDS.map((k) => ({ value: k, label: t(targetKey(k)) })),
  ];

  return (
    <Stack gap={20}>
      <Box className="page-bar">
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 16, flexShrink: 0 }}>
          <Text style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, lineHeight: '22px', color: SNOW }}>
            {t('audit.title')}
          </Text>
        </Box>
        <Box style={{ width: 1, height: 26, backgroundColor: HAIRLINE, flexShrink: 0 }} />
        <Box className="page-bar-facts">
          <Text className="page-bar-fact-soft" style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: MIST }}>
            {t('audit.subtitle')}
          </Text>
          <Box style={{ flex: 1, minWidth: 0 }} />
        </Box>
        <Box className="page-bar-actions" style={{ gap: 8 }}>
          <Select
            size="xs"
            w={240}
            data={actionData}
            value={action}
            onChange={(v) => setAction(v ?? '')}
            allowDeselect={false}
            aria-label={t('audit.col.action')}
          />
          <Select
            size="xs"
            w={160}
            data={targetData}
            value={targetKind}
            onChange={(v) => setTargetKind((v ?? '') as AdminAuditTargetKind | '')}
            allowDeselect={false}
            aria-label={t('audit.col.target')}
          />
          <Box style={{ display: 'flex', padding: 3, borderRadius: 9, backgroundColor: WELL, border: `1px solid ${HAIRLINE}` }}>
            {PERIODS.map((p) => {
              const active = p.days === period.days;
              return (
                <UnstyledButton
                  key={p.key}
                  type="button"
                  onClick={() => setPeriod({ days: p.days, from: periodFrom(p.days, new Date()) })}
                  style={{
                    height: 26,
                    paddingInline: 10,
                    borderRadius: 7,
                    backgroundColor: active ? CARD : 'transparent',
                    border: `1px solid ${active ? EDGE : 'transparent'}`,
                  }}
                >
                  <Text style={{ fontFamily: MONO, fontSize: 11, lineHeight: '14px', color: active ? SNOW : MIST }}>{t(p.key)}</Text>
                </UnstyledButton>
              );
            })}
          </Box>
        </Box>
      </Box>

      {view === 'failed' ? (
        refusal === 'AUDIT_ADMIN_ONLY' ? (
          <Notice text={t('audit.adminOnly')} />
        ) : (
          <LoadFailed
            message={refusal === 'BAD_CURSOR' ? t('audit.badCursor') : apiErrorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        )
      ) : view === 'loading' ? (
        <Box style={{ display: 'flex', justifyContent: 'center', padding: 60, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}` }}>
          <Loader color={CYAN} />
        </Box>
      ) : events.length === 0 ? (
        <Notice text={filtered ? t('audit.emptyFiltered') : t('audit.empty')} />
      ) : (
        <Box style={{ borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}`, overflow: 'hidden' }}>
          <Box style={{ display: 'grid', gridTemplateColumns: COLUMNS, gap: 12, padding: '10px 16px', borderBottom: `1px solid ${HAIRLINE}` }}>
            {(['at', 'actor', 'action', 'target', 'outcome'] as const).map((c) => (
              <Text key={c} style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: FAINT }}>
                {t(`audit.col.${c}`)}
              </Text>
            ))}
          </Box>
          {events.map((e) => (
            <EventRow
              key={e.id}
              e={e}
              open={open.has(e.id)}
              onToggle={() => toggle(e.id)}
              locale={i18n.language}
            />
          ))}
          <Box style={{ display: 'flex', justifyContent: 'center', padding: 12, borderTop: `1px solid ${HAIRLINE}` }}>
            {query.hasNextPage ? (
              <UnstyledButton
                type="button"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                style={{ height: 30, paddingInline: 14, borderRadius: 8, backgroundColor: WELL, border: `1px solid ${EDGE}` }}
              >
                <Text style={{ fontFamily: DISPLAY, fontSize: 12, fontWeight: 500, color: SNOW }}>
                  {query.isFetchingNextPage ? <Loader size={12} color={CYAN} /> : t('audit.more')}
                </Text>
              </UnstyledButton>
            ) : (
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: FAINT }}>{t('audit.end')}</Text>
            )}
          </Box>
          {/* A next page that failed is said under the list, which stays. */}
          {query.isFetchNextPageError && (
            <Box style={{ padding: '0 16px 12px' }}>
              <Text style={{ fontFamily: DISPLAY, fontSize: 12, color: RED }}>
                {refusal === 'BAD_CURSOR' ? t('audit.badCursor') : apiErrorMessage(query.error)}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Stack>
  );
}

function EventRow({ e, open, onToggle, locale }: { e: AdminAuditEventDto; open: boolean; onToggle: () => void; locale: string }) {
  const { t } = useTranslation();
  const tone = e.outcome === 'ok' ? MOSS : e.outcome === 'refused' ? AMBER : RED;
  const lines = open ? detailLines(e, t, locale) : [];
  const cell = { fontFamily: DISPLAY, fontSize: 12, lineHeight: '16px', color: SNOW, minWidth: 0, overflowWrap: 'anywhere' } as const;
  return (
    <Box style={{ borderBottom: `1px solid ${HAIRLINE}`, backgroundColor: open ? ROW : 'transparent' }}>
      <UnstyledButton
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ display: 'grid', gridTemplateColumns: COLUMNS, gap: 12, width: '100%', padding: '10px 16px', textAlign: 'left' }}
      >
        <Text style={{ ...cell, fontFamily: MONO, fontSize: 11, color: MIST }}>{new Date(e.at).toLocaleString(locale)}</Text>
        <Text style={{ ...cell, color: e.actor.kind === 'anonymous' ? MIST : SNOW }}>{actorWords(e, t)}</Text>
        <Text style={cell}>{actionWords(e.action, t)}</Text>
        <Text style={{ ...cell, color: MIST }}>{targetWords(e, t)}</Text>
        <Text style={{ ...cell, color: tone }}>{outcomeWords(e, t)}</Text>
      </UnstyledButton>
      {open && (
        <Box style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(lines.length ? lines : [t('audit.detail.none')]).map((l) => (
            <Text key={l} style={{ fontFamily: MONO, fontSize: 11, lineHeight: '16px', color: lines.length ? SNOW : FAINT }}>
              {l}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <Box style={{ padding: 40, borderRadius: 10, backgroundColor: CARD, border: `1px solid ${HAIRLINE}`, textAlign: 'center' }}>
      <Text style={{ fontFamily: DISPLAY, fontSize: 13, color: MIST }}>{text}</Text>
    </Box>
  );
}
