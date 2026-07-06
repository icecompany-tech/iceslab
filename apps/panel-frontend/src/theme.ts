import {
  Badge,
  Button,
  Card,
  NumberInput,
  Paper,
  PasswordInput,
  Select,
  Table,
  TextInput,
  Textarea,
  MultiSelect,
  Tabs,
  SegmentedControl,
  Switch,
  Divider,
  createTheme,
  rem,
} from '@mantine/core';
import type { MantineColorsTuple } from '@mantine/core';

// IceCore palette, keep in sync with index.css overrides
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const GROUND = '#08101A';
const CYAN = '#7DD3FC';

// Mantine `dark[N]` palette, N=9 darkest, N=0 lightest. Mantine reads these
// for default-styled surfaces (body, modals, popovers, default Buttons,
// hover states). Overriding them once cascades the IceCore palette across
// every uncustomized component.
const dark: MantineColorsTuple = [
  SNOW,         // 0, primary text
  '#A5B4C7',    // 1
  MIST,         // 2, dimmed text
  '#5A6B82',    // 3
  '#3A4A60',    // 4
  '#2C3A4E',    // 5, subtle border
  CARD,         // 6, card surface (Mantine "default" bg)
  '#0B1420',    // 7, body surface (Modal content)
  GROUND,       // 8, body bg
  '#040810',    // 9, deepest
];

const cyan: MantineColorsTuple = [
  '#E6F7FE',
  '#CCEFFD',
  '#A5E2FC',
  '#7DD3FC',
  '#5BC2F8',
  '#3DB0EF',
  '#2A93D1',
  '#1F75A6',
  '#16577A',
  '#0C3A52',
];

const ground: MantineColorsTuple = [
  SNOW,
  MIST,
  '#4A5A72',
  '#2C3A4E',
  HAIRLINE,
  '#152233',
  CARD,
  '#0B1420',
  GROUND,
  '#040810',
];

const amber: MantineColorsTuple = [
  '#FEF6E7',
  '#FCE9C2',
  '#F9D894',
  '#F5B14C',
  '#E89A32',
  '#D08220',
  '#A86616',
  '#7E4C10',
  '#54330B',
  '#2A1A05',
];

const moss: MantineColorsTuple = [
  '#EFF8F2',
  '#D9EEDF',
  '#BFE2CC',
  '#A7D8B9',
  '#84C49C',
  '#62AC7D',
  '#4C8E63',
  '#386B4B',
  '#244732',
  '#10241A',
];

const red: MantineColorsTuple = [
  '#FDEEEA',
  '#FAD4CB',
  '#F1A89A',
  '#E07A5F',
  '#CB5C40',
  '#AE462C',
  '#883420',
  '#622518',
  '#3C1710',
  '#1A0A06',
];

const violet: MantineColorsTuple = [
  '#F1ECFE',
  '#DDD0FB',
  '#C0AAF6',
  '#A78BFA',
  '#8A68F0',
  '#6F4DD6',
  '#553BA8',
  '#3E2B7A',
  '#281C4D',
  '#130E26',
];

const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

// Shared input label/input look, applied to TextInput/Select/NumberInput/Textarea/etc
const inputStyles = {
  label: {
    color: MIST,
    fontFamily: MONO,
    fontSize: rem(10),
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    marginBottom: rem(6),
    fontWeight: 500,
  },
  input: {
    backgroundColor: GROUND,
    borderColor: HAIRLINE,
    color: SNOW,
  },
  description: { color: MIST },
  error: { color: '#E07A5F' },
};

export const theme = createTheme({
  primaryColor: 'cyan',
  primaryShade: 3,
  colors: {
    dark,
    cyan,
    ground,
    amber,
    moss,
    red,
    violet,
  },
  white: SNOW,
  black: GROUND,
  fontFamily:
    "Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontFamilyMonospace: MONO,
  headings: {
    fontFamily: "'Space Grotesk', Inter, sans-serif",
    fontWeight: '500',
    sizes: {
      h1: { fontSize: rem(32), lineHeight: '1.15' },
      h2: { fontSize: rem(24), lineHeight: '1.2' },
      h3: { fontSize: rem(18), lineHeight: '1.3' },
    },
  },
  defaultRadius: 'md',
  radius: {
    xs: rem(4),
    sm: rem(6),
    md: rem(10),
    lg: rem(14),
    xl: rem(20),
  },
  fontSizes: {
    xs: rem(11),
    sm: rem(12),
    md: rem(13),
    lg: rem(15),
    xl: rem(18),
  },
  components: {
    Paper: Paper.extend({
      defaultProps: { radius: 'md' },
    }),
    Card: Card.extend({
      defaultProps: { radius: 'md', bg: CARD },
    }),
    TextInput: TextInput.extend({ styles: inputStyles }),
    PasswordInput: PasswordInput.extend({ styles: inputStyles }),
    NumberInput: NumberInput.extend({ styles: inputStyles }),
    Textarea: Textarea.extend({ styles: inputStyles }),
    Select: Select.extend({ styles: inputStyles }),
    MultiSelect: MultiSelect.extend({ styles: inputStyles }),
    Tabs: Tabs.extend({
      styles: {
        list: { borderBottom: `1px solid ${HAIRLINE}` },
        tab: {
          color: MIST,
          fontFamily: MONO,
          fontSize: rem(11),
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
          fontWeight: 500,
        },
      },
    }),
    Table: Table.extend({
      styles: {
        thead: { backgroundColor: 'transparent' },
        th: {
          color: MIST,
          fontFamily: MONO,
          fontSize: rem(10),
          letterSpacing: '0.12em',
          textTransform: 'uppercase' as const,
          fontWeight: 500,
          borderBottom: `1px solid ${HAIRLINE}`,
        },
        tr: { borderBottom: `1px solid ${HAIRLINE}` },
        td: { color: SNOW, borderBottom: `1px solid ${HAIRLINE}` },
      },
    }),
    SegmentedControl: SegmentedControl.extend({
      styles: {
        root: { backgroundColor: GROUND, border: `1px solid ${HAIRLINE}` },
        indicator: { backgroundColor: CARD, border: `1px solid ${HAIRLINE}` },
        label: { color: MIST },
      },
    }),
    Switch: Switch.extend({
      styles: {
        label: { color: SNOW },
        description: { color: MIST },
      },
    }),
    Divider: Divider.extend({
      styles: { root: { borderColor: HAIRLINE } },
    }),
    Button: Button.extend({
      defaultProps: { radius: 'md' },
      // Mantine's default <Button variant="filled"> uses primaryColor for
      // background and theme.white for text. We set primaryColor='cyan'
      // (light) and white=SNOW (also light), the pair renders unreadable
      // cyan-on-snow CTAs ("I have saved it" in NodePayloadModal, etc).
      // Override --button-color to GROUND for filled+default-color so every
      // CTA is legible without per-call style overrides. Buttons that pass
      // an explicit color (red/green/etc) keep Mantine's normal contrast.
      vars: (_theme, props) => {
        const filled = props.variant === 'filled' || props.variant === undefined;
        if (filled && !props.color) {
          return { root: { '--button-color': GROUND } };
        }
        return { root: {} };
      },
    }),
    Badge: Badge.extend({
      defaultProps: { radius: 'sm' },
    }),
  },
  other: {
    surfaceGround: GROUND,
    surfaceCard: CARD,
    surfaceCardHi: '#152233',
    hairline: HAIRLINE,
    snow: SNOW,
    mist: MIST,
    accentCyan: CYAN,
    accentCyan2: '#67E8F9',
    accentAmber: '#F5B14C',
    accentMoss: '#A7D8B9',
    accentRed: '#E07A5F',
    accentViolet: '#A78BFA',
    accentPurple: '#C78BFA',
    accentPink: '#F5A3B8',
  },
});
