/**
 * Runs a save, and only if it went through, what comes after it (close the
 * form, reset it).
 *
 * A refused save used to be rethrown past the form: Mantine's submit handler
 * does not catch, so every 400 or 500 ended as an unhandled rejection in the
 * console, after the page had already shown its notification. The refusal is
 * the caller's to report (the page's mutation does it in `onError`); here it
 * only has to stop the form from closing and from forgetting what the
 * operator typed. `false` means refused.
 */
export async function saveThen(save: () => Promise<void>, after: () => void): Promise<boolean> {
  try {
    await save();
  } catch {
    return false;
  }
  after();
  return true;
}
