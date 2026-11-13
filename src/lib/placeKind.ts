// Which kind a place pin of an event shows: its own kind (a detailed report: strikes here, shelling
// there) — except under a Killed / Wounded / Assassination main type, where every pin shows the main
// icon (the place kind is the means of the attack, already a secondary type). null = the main kind.
const STICKY_MAIN = ['killed', 'wounded', 'assassination'];

export function placeKind(mainSlug: string, placeSlug: string | null | undefined): string | null {
  if (!placeSlug || placeSlug === mainSlug || STICKY_MAIN.includes(mainSlug)) return null;
  return placeSlug;
}
