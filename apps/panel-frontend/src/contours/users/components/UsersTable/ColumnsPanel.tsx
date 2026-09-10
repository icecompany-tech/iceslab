import { DEFAULT_COLUMN_VIEW, USER_COLUMNS, USER_COLUMN_BY_ID } from '@/contours/users/lib/usersTable';
import { IconGripVertical, IconLayoutColumns, IconPinnedOff, IconArrowBarToLeft, IconArrowBarToRight } from '@tabler/icons-react';
import { Box, Popover, Switch, Text, UnstyledButton } from '@mantine/core';
import { CARD, CYAN, DISPLAY, HAIRLINE, MIST, SNOW, WELL } from '@/contours/users/lib/colors';
import { MONO_LABEL } from '@/contours/users/lib/textStyles';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

/** Fixed, and the reordering arithmetic leans on it. */
const ROW_HEIGHT = 30;
import type { UsersPageState } from '@/contours/users/screens/useUsersPage';

/**
 * Which columns the roster shows, in which order, and which of them stay put
 * while the rest scroll sideways. Twenty-three columns do not fit a screen and
 * never will, so the panel is the answer to "where did the thing I need go"
 * rather than a settings page nobody finds.
 */
export function ColumnsPanel({
  columnView,
  setColumnView,
  toggleColumn,
  pinColumn,
  moveColumn,
}: Pick<UsersPageState, 'columnView' | 'setColumnView' | 'toggleColumn' | 'pinColumn' | 'moveColumn'>) {
  const { t } = useTranslation();
  const shownCount = USER_COLUMNS.length - columnView.hidden.length;

  /**
   * Reordering by pointer rather than by the browser's own drag.
   *
   * Native HTML5 drag gave a ghost image and no idea where the row would
   * land. Here the order is left alone while the finger is down and the rows
   * are only moved on screen: the one being dragged follows the cursor, the
   * ones it passes slide out of its way by exactly one row, and the list
   * commits the new order on release. Rows are a fixed 30px, which is what
   * makes the arithmetic honest.
   */
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  const startY = useRef(0);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dy = e.clientY - startY.current;
      const to = Math.min(
        columnView.order.length - 1,
        Math.max(0, drag.from + Math.round(dy / ROW_HEIGHT)),
      );
      setDrag((d) => (d ? { ...d, to, dy } : d));
    };
    const onUp = () => {
      setDrag((d) => {
        if (d && d.to !== d.from) moveColumn(d.from, d.to);
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, columnView.order.length, moveColumn]);

  /** How far a row has to step aside to make room for the one being dragged. */
  function shiftOf(index: number): number {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -ROW_HEIGHT;
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return ROW_HEIGHT;
    return 0;
  }

  return (
    <Popover position="bottom-end" width={380} shadow="md" withinPortal>
      <Popover.Target>
        <UnstyledButton
          title={t('usersTable.columnsPanel')}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: MIST,
            backgroundColor: WELL,
            border: `1px solid ${HAIRLINE}`,
          }}
        >
          <IconLayoutColumns size={14} stroke={1.8} />
        </UnstyledButton>
      </Popover.Target>

      <Popover.Dropdown
        style={{ backgroundColor: CARD, borderColor: HAIRLINE, borderRadius: 10, padding: 0 }}
      >
        {/* Four verbs over the whole list, because reaching the same state one
            toggle at a time across twenty-three rows is not a real option. */}
        <Box
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '13px 14px',
            borderBottom: `1px solid ${HAIRLINE}`,
          }}
        >
          <PanelAction
            label={t('usersTable.hideAll')}
            onClick={() =>
              setColumnView({ ...columnView, hidden: USER_COLUMNS.map((c) => c.id) })
            }
          />
          <PanelAction
            label={t('usersTable.resetOrder')}
            onClick={() => setColumnView({ ...columnView, order: DEFAULT_COLUMN_VIEW.order })}
          />
          <PanelAction
            label={t('usersTable.unpinAll')}
            onClick={() => setColumnView({ ...columnView, pins: {} })}
          />
          <PanelAction
            label={t('usersTable.showAll')}
            onClick={() => setColumnView({ ...columnView, hidden: [] })}
          />
          <Box style={{ flex: 1 }} />
          <Text style={{ ...MONO_LABEL }}>{shownCount}/{USER_COLUMNS.length}</Text>
        </Box>

        {/* While a row is being dragged the list must not scroll under it, or
            the pointer arithmetic would be measuring against a moving floor. */}
        <Box
          style={{
            maxHeight: 443,
            overflowY: drag ? 'hidden' : 'auto',
            padding: 6,
            touchAction: drag ? 'none' : undefined,
          }}
        >
          {columnView.order.map((id, index) => {
            const column = USER_COLUMN_BY_ID.get(id);
            if (!column) return null;
            const visible = !columnView.hidden.includes(id);
            const pin = columnView.pins[id] ?? null;
            return (
              <Box
                key={id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: ROW_HEIGHT,
                  paddingInline: 6,
                  borderRadius: 6,
                  transform: `translateY(${shiftOf(index)}px)`,
                  // The row under the finger must not lag behind it; the ones
                  // stepping aside are the only thing that should animate.
                  transition: drag?.from === index ? 'none' : 'transform 140ms ease',
                  position: 'relative',
                  zIndex: drag?.from === index ? 2 : 1,
                  backgroundColor: drag?.from === index ? WELL : undefined,
                  boxShadow: drag?.from === index ? '0 8px 20px #00000059' : undefined,
                }}
              >
                <Box
                  onPointerDown={(e) => {
                    e.preventDefault();
                    startY.current = e.clientY;
                    setDrag({ from: index, to: index, dy: 0 });
                  }}
                  style={{
                    display: 'flex',
                    color: MIST,
                    cursor: drag ? 'grabbing' : 'grab',
                    flexShrink: 0,
                    touchAction: 'none',
                  }}
                >
                  <IconGripVertical size={14} stroke={1.8} />
                </Box>
                <PinButton
                  active={pin === 'left'}
                  title={t('usersTable.pinLeft')}
                  onClick={() => pinColumn(id, 'left')}
                  icon={<IconArrowBarToLeft size={14} stroke={1.8} />}
                />
                <PinButton
                  active={pin === 'right'}
                  title={t('usersTable.pinRight')}
                  onClick={() => pinColumn(id, 'right')}
                  icon={<IconArrowBarToRight size={14} stroke={1.8} />}
                />
                <Switch
                  size="xs"
                  checked={visible}
                  onChange={() => toggleColumn(id)}
                  styles={{ track: { cursor: 'pointer' } }}
                />
                <Text
                  style={{
                    fontFamily: DISPLAY,
                    fontSize: 13,
                    lineHeight: '16px',
                    color: visible ? SNOW : MIST,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t(`users.table.${column.label}`)}
                </Text>
                {pin && (
                  <UnstyledButton
                    title={t('usersTable.unpin')}
                    onClick={() => pinColumn(id, pin)}
                    style={{ display: 'flex', color: CYAN, flexShrink: 0 }}
                  >
                    <IconPinnedOff size={13} stroke={1.8} />
                  </UnstyledButton>
                )}
              </Box>
            );
          })}
        </Box>
      </Popover.Dropdown>
    </Popover>
  );
}

function PanelAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <UnstyledButton onClick={onClick}>
      <Text style={{ ...MONO_LABEL, color: MIST }}>{label}</Text>
    </UnstyledButton>
  );
}

function PinButton({
  active,
  title,
  onClick,
  icon,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <UnstyledButton
      title={title}
      onClick={onClick}
      style={{ display: 'flex', color: active ? CYAN : MIST, flexShrink: 0 }}
    >
      {icon}
    </UnstyledButton>
  );
}
