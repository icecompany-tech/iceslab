// Set at runtime by react-aria-components on its overlays, not by tokens.css.
const RUNTIME_TOKENS = new Set(['--trigger-width', '--trigger-anchor-point', '--overlay-height'])

export function undefinedTokens(sheets, tokensCss) {
  const declared = new Set([...tokensCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
  return Object.entries(sheets).flatMap(([file, css]) =>
    [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))]
      .filter((name) => !declared.has(name) && !RUNTIME_TOKENS.has(name))
      .map((name) => `${file}: ${name}`),
  )
}

// Codex F8: layer names of the page "Компоненты", by the names accepted in
// docs/plan/blackhole/components.md (ARCH 2026-11-06: ui/Segmented, ui/Chip, ui/Dialog).
// A component with no layer here is either a new master for Paper or a wrong name.
const PAPER_LAYERS = new Set([
  'AlertCard', 'ApiGroup', 'ApiRow', 'AppTile', 'AuthCard', 'AuthNotice', 'AwgKeys', 'Banner', 'BarRow', 'Button',
  'CascadeFlow', 'CascadeRow', 'CascadeStrip', 'ChartStats', 'Check', 'Chip', 'CodeArea', 'CodeInput', 'ColumnFilter',
  'ColumnResize', 'ColumnsPanel', 'Command', 'CoreChip', 'CorePicker', 'DevicePicker', 'DeviceList', 'Dialog',
  'EmptyState', 'FieldAction', 'Flag', 'HopMeter', 'HostCard', 'HourBars', 'Icon', 'IconButton', 'InstallStep', 'Kbd',
  'LinkButton', 'Menu', 'Meter', 'NavGroup', 'NavItem', 'NodeCard', 'NodeRow', 'PolicyList', 'Popover', 'PresetCard',
  'PresetSelect', 'ProfileCard', 'ProtocolTile', 'QR', 'QueryState', 'RadioRow', 'RowMenu', 'RowResize', 'RuleTable',
  'Search', 'SearchInput', 'Segmented', 'Select', 'ServerRow', 'Sheet', 'SquadCard', 'SquadSelect', 'SquadTag',
  'StatCard', 'StatRow', 'StatTile', 'Step', 'StepFlow', 'SubStatus', 'Summary', 'Switch', 'SystemStrip', 'Table',
  'TableRow', 'Toolbar', 'TrafficChart', 'VersionList', 'ViewToggle',
  // The срок field of ui/UserWindow is an unnamed frame in Paper: this name is the code's
  // until DSGN names the layer.
  'DateTimeField',
])

export const unknownLayers = (folders) => folders.filter((f) => !PAPER_LAYERS.has(f))

const STATES = [
  ['загрузка', /загрузк/i],
  ['пусто', /пуст/i],
  ['сбой', /сбой|ошибк/i],
  ['не проверено', /не проверен/i],
]

/** @param tests screen file -> text of its test file, or null when there is none */
export function screensWithoutStates(tests) {
  return Object.entries(tests).flatMap(([file, text]) => {
    if (text === null) return [`${file}: no test file`]
    const missing = STATES.filter(([, re]) => !re.test(text)).map(([name]) => name)
    return missing.length > 0 ? [`${file}: ${missing.join(', ')}`] : []
  })
}
