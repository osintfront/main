// Which marker groups of the military layer to touch. Tens of thousands of markers live in these groups, so a
// group is cleared and refilled only when its own inputs changed: whether it is shown, the foreign filter (while
// shown), or its markers (a file loaded, the language changed). No Leaflet here; groups are injected.
import type { MilKind } from './military.ts';

export interface GroupLike<M> { clearLayers(): void; addLayers(m: M[]): void; addTo(map: unknown): void; remove(): void }
export interface MilView { on: Record<MilKind, boolean>; foreignOnly: boolean; zoomOk: boolean }

const KINDS: MilKind[] = ['base', 'naval', 'range', 'minor'];

export class MilitaryMarkers<M> {
  private items: Record<MilKind, { f: boolean; m: M }[]> = { base: [], naval: [], range: [], minor: [] };
  private version: Record<MilKind, number> = { base: 0, naval: 0, range: 0, minor: 0 };
  private applied: Partial<Record<MilKind, string>> = {};
  private groups: Partial<Record<MilKind, GroupLike<M>>> = {};

  private readonly makeGroup: (k: MilKind) => GroupLike<M>;

  constructor(makeGroup: (k: MilKind) => GroupLike<M>) { this.makeGroup = makeGroup; }

  /** Replace the markers of these kinds (one file's worth). */
  setMarkers(kinds: MilKind[], list: { k: MilKind; f: boolean; m: M }[]): void {
    for (const k of kinds) { this.items[k] = []; this.version[k] += 1; }
    for (const x of list) if (kinds.includes(x.k)) this.items[x.k].push({ f: x.f, m: x.m });
  }

  apply(view: MilView, map: unknown): void {
    for (const k of KINDS) {
      const shown = view.on[k] && (k !== 'minor' || view.zoomOk);
      const key = shown ? `${this.version[k]}|${view.foreignOnly}` : 'off';
      if (this.applied[k] === key || (!shown && !this.groups[k])) { this.applied[k] = key; continue; }
      const g = (this.groups[k] ??= this.makeGroup(k));
      g.clearLayers();
      if (shown) {
        g.addLayers(this.items[k].filter((x) => !view.foreignOnly || x.f).map((x) => x.m));
        g.addTo(map);
      } else g.remove();
      this.applied[k] = key;
    }
  }

  removeAll(): void {
    for (const g of Object.values(this.groups)) g?.remove();
    this.applied = {};
  }
}

/** Is a foreign-operated site among the kinds that are on? (For the legend.) */
export function foreignShown(files: (GeoJSON.FeatureCollection | undefined)[], on: Record<MilKind, boolean>): boolean {
  return files.some((fc) => fc?.features.some((f) => {
    const p = f.properties as { k?: MilKind; f?: boolean } | null;
    return !!p?.f && !!p.k && on[p.k];
  }) ?? false);
}
