/**
 * What the node page does with a re-issued bootstrap token (A-147).
 *
 * It used to write the command to `navigator.clipboard` inside the mutation's
 * onSuccess and toast «copied». On plain http (the case `lib/ui/clipboard.ts`
 * exists for) `navigator.clipboard` is undefined, the call threw before its
 * `.catch`, TanStack Query moved the mutation to onError, and the operator got
 * «Cannot read properties of undefined» while the token HAD been issued and
 * its command was shown nowhere. On https a refused write still toasted
 * «copied».
 *
 * Now the command is shown (the same modal the node list uses, whose copy
 * button goes through copyToClipboard and says whether it copied), and the
 * toast says only what is true: a token was issued. Nothing here touches the
 * clipboard, so nothing here can throw.
 */
// The domain's own shape, payloadOnly included (A-295): a copy here would drop
// the flag on the way to the modal.
import type { BootstrapInfo } from '@/lib/old/nodes';
import { isPayloadOnly } from '@/contours/nodes/lib/payloadInstall';
export type { BootstrapInfo };

export function onBootstrapIssued(
  info: BootstrapInfo,
  show: (info: BootstrapInfo) => void,
  notify: (n: { title: string; message: string; color?: string }) => void,
  t: (key: string) => string,
): void {
  show(info);
  // A-295: without https the new token installs nothing, so the toast is not
  // a green «ready»: it points at the window, which says what is needed.
  if (isPayloadOnly(info)) {
    notify({ color: 'yellow', title: t('nodeEdit.bootstrapPayloadOnly'), message: t('nodeEdit.bootstrapPayloadOnlyShown') });
    return;
  }
  notify({ title: t('nodeEdit.bootstrapIssued'), message: t('nodeEdit.bootstrapShown') });
}
