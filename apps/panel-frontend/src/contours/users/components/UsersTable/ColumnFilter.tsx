import { useTranslation } from 'react-i18next';
import { Box, Menu, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconFilter, IconFilterFilled, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { listNodes } from '@/lib/domain/nodes';
import type { UserFilters } from '@/lib/domain/users';
import { filterKeys, type ColumnFilter as Descriptor } from '@/contours/users/lib/usersTable';
import { AMBER, CYAN, HAIRLINE, MIST, SNOW, WELL } from '@/contours/users/lib/colors';
import { MONO, MONO_LABEL } from '@/contours/users/lib/textStyles';

/**
 * The filters that do not fit a 28px lane, behind the lane.
 *
 * Username and status stay inline: they are the two an operator reaches for
 * without thinking. Everything else is a pair of dates, a pair of sizes or a
 * choice, none of which fits under a 130px heading, so the lane holds a single
 * button that says whether the column is narrowed and opens the controls.
 *
 * Every control here sends a parameter the list endpoint answers to. Nothing
 * filters in the browser: the table shows one page of N, and narrowing that
 * page would quietly answer a different question than the one asked.
 */
export function ColumnFilterButton({
  filter,
  params,
  setParam,
  clearParams,
}: {
  filter: Descriptor;
  params: UserFilters;
  setParam: (patch: UserFilters) => void;
  clearParams: (keys: (keyof UserFilters)[]) => void;
}) {
  const { t } = useTranslation();
  const keys = filterKeys(filter);
  const active = keys.some((k) => params[k] !== undefined);

  return (
    <Menu position="bottom-start" width={248} shadow="md" closeOnItemClick={false}>
      <Menu.Target>
        <UnstyledButton
          title={t('usersTable.filterBy')}
          style={{
            height: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            paddingInline: 9,
            borderRadius: 6,
            backgroundColor: WELL,
            border: `1px solid ${active ? CYAN : HAIRLINE}`,
            width: '100%',
          }}
        >
          {active ? (
            <IconFilterFilled size={11} color={CYAN} />
          ) : (
            <IconFilter size={11} color={MIST} />
          )}
          <Text
            style={{
              ...MONO_LABEL,
              color: active ? SNOW : MIST,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'left',
            }}
          >
            {active ? t('usersTable.filterOn') : t('usersTable.filterBy')}
          </Text>
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown style={{ backgroundColor: WELL, borderColor: HAIRLINE, padding: 12 }}>
        <Stack gap={10}>
          <Body filter={filter} params={params} setParam={setParam} />
          {active && (
            <UnstyledButton
              onClick={() => clearParams(keys)}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <IconX size={11} color={MIST} />
              <Text style={{ ...MONO_LABEL, color: MIST }}>{t('usersTable.filterClear')}</Text>
            </UnstyledButton>
          )}
        </Stack>
      </Menu.Dropdown>
    </Menu>
  );
}

function Body({
  filter,
  params,
  setParam,
}: {
  filter: Descriptor;
  params: UserFilters;
  setParam: (patch: UserFilters) => void;
}) {
  const { t } = useTranslation();

  if (filter.kind === 'node') return <NodeFilter params={params} setParam={setParam} />;

  if (filter.kind === 'choice') {
    const { param, values } = filter;
    return (
      <Field label={t('usersTable.filterHas')}>
        <Select
          value={(params[param] as string | undefined) ?? ''}
          onChange={(v) => setParam({ [param]: v || undefined })}
          options={[
            { value: '', label: t('usersTable.filterAny') },
            // Keyed by parameter AND value: `set` means "has a device limit"
            // under one heading and "has an email" under another, so one label
            // per word would put the wrong sentence under half of them.
            ...values.map((v) => ({ value: v, label: t(`usersTable.filterValue.${param}.${v}`) })),
          ]}
        />
      </Field>
    );
  }

  if (filter.kind === 'dates') {
    return (
      <Stack gap={10}>
        {filter.presence !== undefined && (
          <PresenceField param={filter.presence} params={params} setParam={setParam} />
        )}
        <Field label={t('usersTable.filterAfter')}>
          <DateBox
            value={(params[filter.after] as string | undefined) ?? ''}
            onChange={(v) => setParam({ [filter.after]: v || undefined })}
          />
        </Field>
        <Field label={t('usersTable.filterBefore')}>
          <DateBox
            value={(params[filter.before] as string | undefined) ?? ''}
            onChange={(v) => setParam({ [filter.before]: v || undefined })}
          />
        </Field>
        {/* A date comparison never matches NULL, so rows without the date fall
            out of the answer without a word. Where that is common the column
            says so here, next to the control that does it. */}
        {filter.note && (
          // A sentence, so not MONO_LABEL: that style is uppercase with wide
          // tracking, which turns six lines of prose into a wall.
          <Text style={{ ...MONO, fontSize: 11, lineHeight: '16px', color: AMBER }}>
            {t(filter.note)}
          </Text>
        )}
      </Stack>
    );
  }

  // bytes: the operator thinks in GB, the endpoint counts bytes.
  if (filter.kind === 'bytes') {
    const { over, under } = filter;
    return (
      <Stack gap={10}>
        <Field label={t('usersTable.filterOver')}>
          <NumBox
            value={toGb(params[over] as number | undefined)}
            onChange={(v) => setParam({ [over]: toBytes(v) })}
          />
        </Field>
        <Field label={t('usersTable.filterUnder')}>
          <NumBox
            value={toGb(params[under] as number | undefined)}
            onChange={(v) => setParam({ [under]: toBytes(v) })}
          />
        </Field>
      </Stack>
    );
  }

  // search and status never reach here: they are drawn inline in the lane.
  return null;
}

/** The has-it-at-all question above a date pair. Its own component so the
 *  narrowed `presence` key survives into the callbacks. */
function PresenceField({
  param,
  params,
  setParam,
}: {
  param: keyof UserFilters;
  params: UserFilters;
  setParam: (patch: UserFilters) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field label={t('usersTable.filterHas')}>
      <Select
        value={(params[param] as string | undefined) ?? ''}
        onChange={(v) => setParam({ [param]: v || undefined })}
        options={[
          { value: '', label: t('usersTable.filterAny') },
          { value: 'yes', label: t(`usersTable.filterValue.${param}.yes`) },
          { value: 'no', label: t(`usersTable.filterValue.${param}.no`) },
        ]}
      />
    </Field>
  );
}

function NodeFilter({
  params,
  setParam,
}: {
  params: UserFilters;
  setParam: (patch: UserFilters) => void;
}) {
  const { t } = useTranslation();
  // The fleet is small and every other screen already holds this cache.
  const nodesQuery = useQuery({ queryKey: ['nodes'], queryFn: () => listNodes() });
  const nodes = nodesQuery.data?.nodes ?? [];

  return (
    <Stack gap={10}>
      <Field label={t('usersTable.filterNode')}>
        <Select
          value={(params.nodeId as string | undefined) ?? ''}
          onChange={(v) => setParam({ nodeId: (v || undefined) as UserFilters['nodeId'] })}
          options={[
            { value: '', label: t('usersTable.filterAny') },
            // "none" is a real answer, not the absence of one: it asks for the
            // people who have never connected anywhere.
            { value: 'none', label: t('usersTable.filterNodeNone') },
            ...nodes.map((n) => ({ value: n.id, label: n.name })),
          ]}
        />
      </Field>
      <Field label={t('usersTable.filterOnline')}>
        <Select
          value={(params.online as string | undefined) ?? ''}
          onChange={(v) => setParam({ online: (v || undefined) as UserFilters['online'] })}
          options={[
            { value: '', label: t('usersTable.filterAny') },
            { value: 'online', label: t('usersTable.filterValue.online.online') },
            { value: 'offline', label: t('usersTable.filterValue.online.offline') },
            { value: 'never', label: t('usersTable.filterValue.online.never') },
          ]}
        />
      </Field>
    </Stack>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={5}>
      <Text style={{ ...MONO_LABEL, color: MIST }}>{label}</Text>
      {children}
    </Stack>
  );
}

const boxStyle = {
  ...MONO_LABEL,
  height: 30,
  width: '100%',
  paddingInline: 9,
  borderRadius: 6,
  backgroundColor: '#08101A',
  border: `1px solid ${HAIRLINE}`,
  outline: 'none',
  // After the spread on purpose: MONO_LABEL carries its own muted ink, and a
  // value the operator typed is not a label.
  color: SNOW,
} as const;

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Box
      component="select"
      value={value}
      onChange={(e: { currentTarget: { value: string } }) => onChange(e.currentTarget.value)}
      style={{ ...boxStyle, appearance: 'none' }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Box>
  );
}

function DateBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Box
      component="input"
      type="date"
      value={value.slice(0, 10)}
      onChange={(e: { currentTarget: { value: string } }) => onChange(e.currentTarget.value)}
      style={boxStyle}
    />
  );
}

function NumBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Box
      component="input"
      type="number"
      min={0}
      value={value}
      placeholder="GB"
      onChange={(e: { currentTarget: { value: string } }) => onChange(e.currentTarget.value)}
      style={boxStyle}
    />
  );
}

const GB = 1024 ** 3;
function toGb(bytes: number | undefined): string {
  return bytes === undefined ? '' : String(Math.round((bytes / GB) * 100) / 100);
}
function toBytes(gb: string): number | undefined {
  const n = Number(gb);
  return gb === '' || Number.isNaN(n) ? undefined : Math.round(n * GB);
}
