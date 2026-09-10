import { DISPLAY, FAINT } from '@/contours/nodes/lib/colors';

/**
 * On this page the hint belongs UNDER the control, the way the artboard reads
 * it: label, the thing you type into, then the sentence explaining what you
 * just typed. Mantine's default puts the description above the input, which
 * pushes two side-by-side fields off each other's baseline whenever one hint
 * wraps and the other does not.
 */
export const FIELD = {
  inputWrapperOrder: ['label', 'input', 'description', 'error'] as (
    | 'label'
    | 'input'
    | 'description'
    | 'error'
  )[],
  styles: {
    description: {
      color: FAINT,
      fontFamily: DISPLAY,
      fontSize: 11,
      lineHeight: '15px',
      marginTop: 6,
    },
  },
};
