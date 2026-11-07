// Set at runtime by react-aria-components on its overlays, not by tokens.css.
const RUNTIME_TOKENS = new Set(['--trigger-width', '--trigger-anchor-point', '--overlay-height'])

const declaredIn = (css) => new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))

export function undefinedTokens(sheets, tokensCss) {
  const declared = declaredIn(tokensCss)
  return Object.entries(sheets).flatMap(([file, css]) => {
    const local = declaredIn(css)
    return [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))]
      .filter((name) => !declared.has(name) && !local.has(name) && !RUNTIME_TOKENS.has(name))
      .map((name) => `${file}: ${name}`)
  })
}

// Codex F8, both ways. Layer names of the page "Компоненты", by the names accepted in
// components.md (ARCH 2026-11-06: ui/Segmented, ui/Chip, ui/Dialog). A folder with no layer
// is a new master for Paper or a wrong name; a layer with no folder must be listed in
// NOT_BUILT, and a built one must leave that list, so the list can only shrink to empty.
const PAPER_LAYERS = new Set([
  'AlertCard', 'ApiGroup', 'ApiRow', 'AppTile', 'AuthCard', 'AuthNotice', 'AwgKeys', 'Banner', 'BarRow', 'Button',
  'CascadeFlow', 'CascadeRow', 'CascadeStrip', 'ChartStats', 'Check', 'Chip', 'CodeArea', 'CodeInput', 'ColumnFilter',
  'ColumnResize', 'ColumnsPanel', 'Command', 'CoreChip', 'CorePicker', 'DevicePicker', 'DeviceList', 'Dialog', 'Field',
  'EmptyState', 'FieldAction', 'Flag', 'HopMeter', 'HostCard', 'HourBars', 'Icon', 'IconButton', 'InstallStep', 'Kbd',
  'LinkButton', 'Menu', 'Meter', 'NavGroup', 'NavItem', 'NodeCard', 'NodeRow', 'PolicyList', 'Popover', 'PresetCard',
  'PresetSelect', 'ProfileCard', 'ProtocolTile', 'QR', 'QueryState', 'RadioRow', 'RowMenu', 'RowResize', 'RuleTable',
  'Search', 'SearchInput', 'Segmented', 'Select', 'ServerRow', 'Sheet', 'SquadCard', 'SquadSelect', 'SquadTag',
  'StatCard', 'StatRow', 'StatTile', 'Step', 'StepFlow', 'SubStatus', 'Summary', 'Switch', 'SystemStrip', 'Table',
  'TableRow', 'Toolbar', 'TrafficChart', 'VersionList', 'ViewToggle',
  // The срок field of ui/UserWindow is an unnamed frame in Paper; DSGN drew the board 06.11.
  'DateTimeField', 'Toast',
])

// Parts of another component's folder here: NavItem and NavGroup are shell code.
const IN_ANOTHER_FOLDER = new Set(['NavGroup', 'NavItem', 'SquadTag', 'TableRow', 'SearchInput', 'Search'])

export const NOT_BUILT = new Set([
  'AlertCard', 'ApiGroup', 'ApiRow', 'AppTile', 'AwgKeys', 'BarRow', 'CascadeRow', 'CascadeStrip',
  'ChartStats', 'ColumnFilter', 'ColumnResize', 'ColumnsPanel', 'CorePicker', 'DevicePicker', 'DeviceList', 'EmptyState', 'FieldAction', 'HostCard',
  'IconButton', 'InstallStep', 'Kbd', 'LinkButton', 'NodeCard', 'NodeRow', 'PolicyList',
  'PresetCard', 'PresetSelect', 'ProfileCard', 'ProtocolTile', 'QR', 'RowMenu', 'RowResize',
  'RuleTable', 'ServerRow', 'Sheet', 'SquadCard', 'StatRow', 'StatTile', 'StepFlow',
  'SubStatus', 'Summary', 'SystemStrip', 'Table', 'Toolbar', 'VersionList', 'ViewToggle',
])

export const unknownLayers = (folders) => folders.filter((f) => !PAPER_LAYERS.has(f))

export function layersWithoutCode(folders) {
  const built = new Set(folders)
  return [...PAPER_LAYERS].filter((l) => !built.has(l) && !NOT_BUILT.has(l) && !IN_ANOTHER_FOLDER.has(l))
}

export const builtButListed = (folders) => folders.filter((f) => NOT_BUILT.has(f))

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

/**
 * Codex F4, F-K3: a form sends only what changed. Every file that builds a write body has
 * a test holding that an untouched form sends nothing; the name is the door.
 * @param files file -> its text, for `lib/*Patch.ts` and `lib/*Body.ts` in the contours
 */
export function writeBodiesWithoutUntouchedTest(files, tests) {
  return Object.keys(files).filter((file) => {
    const test = tests[file.replace(/\.ts$/, '.test.ts')]
    return test === undefined || !/untouched|нетронут/i.test(test)
  })
}
