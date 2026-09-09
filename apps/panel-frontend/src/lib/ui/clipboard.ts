/**
 * Copy a string to clipboard, falling back to document.execCommand('copy')
 * when navigator.clipboard is unavailable.
 *
 * The modern async API works only in "secure contexts" (https or localhost).
 * Admins running the panel on plain http://<vps-ip>:8080 hit silent failures
 * with it, the legacy execCommand path covers that case.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return;
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
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}
