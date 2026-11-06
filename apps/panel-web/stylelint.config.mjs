// Codex F6 and F7 in CSS: colours, sizes and faces come from tokens.css, the one file
// allowed to hold literals. lint/rules.test.mjs proves each rule fires.
const fromToken = ['/^var\\(/', '/^calc\\(/', 'inherit', '0']

export default {
  ignoreFiles: ['src/ui/tokens.css', 'dist/**'],
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch'],
    'unit-disallowed-list': ['px', 'rem', 'em', 'pt'],
    'at-rule-disallowed-list': ['font-face', 'import'],
    'property-disallowed-list': ['font'],
    'declaration-property-value-allowed-list': {
      'font-family': ['/^var\\(--font-/', 'inherit'],
      'font-size': fromToken,
      'font-weight': fromToken,
      'border-radius': fromToken,
      'letter-spacing': fromToken,
    },
  },
}
