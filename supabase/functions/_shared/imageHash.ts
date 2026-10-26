// Picture fingerprints, so the same photo posted by several channels is kept once per event.
//  - sha: the exact bytes (a straight repost).
//  - phash: a 64-bit difference hash (dHash) of a 9×8 grey thumbnail. Survives re-compression
//    and resizing (another channel re-saving the same photo), so two copies differ by a few bits.
import jpeg from "npm:jpeg-js@0.4.4";

export interface ImageHash { sha: string; phash: string | null }

/** Hamming distance below this = the same picture. */
export const SAME_PICTURE_BITS = 8;

export async function hashImage(bytes: Uint8Array, mime = "image/jpeg"): Promise<ImageHash> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const sha = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { sha, phash: mime === "image/jpeg" ? dhash(bytes) : null };
}

function dhash(bytes: Uint8Array): string | null {
  try {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 256 });
    const { width: w, height: h, data } = img;
    if (!w || !h) return null;
    // Average grey of each cell of a 9×8 grid.
    const W = 9, H = 8;
    const grid = new Float64Array(W * H);
    for (let gy = 0; gy < H; gy++) {
      const y0 = Math.floor((gy * h) / H), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / H));
      for (let gx = 0; gx < W; gx++) {
        const x0 = Math.floor((gx * w) / W), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / W));
        let sum = 0, n = 0;
        // Every second pixel is plenty for an average and halves the work.
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            const i = (y * w + x) * 4;
            sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            n++;
          }
        }
        grid[gy * W + gx] = n ? sum / n : 0;
      }
    }
    let hex = "";
    for (let gy = 0; gy < H; gy++) {
      let byte = 0;
      for (let gx = 0; gx < 8; gx++) byte = (byte << 1) | (grid[gy * W + gx] > grid[gy * W + gx + 1] ? 1 : 0);
      hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
  } catch {
    return null;
  }
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** Is this picture already among the event's pictures (same bytes, or the same photo)? */
export function alreadyHas(existing: { sha?: string | null; phash?: string | null }[], h: ImageHash): boolean {
  return existing.some((e) =>
    (e.sha && e.sha === h.sha) || (e.phash && h.phash && hamming(e.phash, h.phash) <= SAME_PICTURE_BITS));
}
