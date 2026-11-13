/**
 * Saving the secondary types after the event itself saved: a failure here must not look like a failed
 * save (the event is there; pressing Save again would make a second one). It warns and goes on.
 */
export async function saveSecondary(save: () => Promise<unknown>, warn: () => void): Promise<boolean> {
  try {
    await save();
    return true;
  } catch {
    warn();
    return false;
  }
}
