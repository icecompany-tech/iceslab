/**
 * Copy a string to clipboard, falling back to document.execCommand('copy')
 * when navigator.clipboard is unavailable.
 *
 * The modern async API works only in "secure contexts" (https or localhost).
 * Admins running the panel on plain http://<vps-ip>:8080 hit silent failures
 * with it, the legacy execCommand path covers that case.
 *
 * Returns whether the copy actually happened. A button that says «Скопировано»
 * must be able to tell, otherwise it confirms what may not have occurred; the
 * callers that ignore the answer keep working as before.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy path below
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}
