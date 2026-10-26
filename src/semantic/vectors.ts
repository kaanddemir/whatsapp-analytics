/* Message vectors in typed arrays: int8 codes with one float scale per vector
   (388 bytes per message at 384 dimensions, a quarter of float32), in
   fixed-size segments so indexing can commit and resume segment by segment.
   Search is an exact scan of every vector that passes the filters: no
   approximate index whose misses would be invisible. */

export const SEGMENT_SIZE = 2048;

export interface Segment {
  /** Message numbers, ascending within the index. */
  readonly ids: Int32Array;
  readonly scales: Float32Array;
  readonly codes: Int8Array;
  readonly count: number;
}

/** Quantize one L2-normalised vector into `codes` at `at`; returns its scale. */
export function quantize(v: Float32Array, from: number, dim: number, codes: Int8Array, at: number): number {
  let max = 0;
  for (let j = 0; j < dim; j++) max = Math.max(max, Math.abs(v[from + j]!));
  const scale = max > 0 ? max / 127 : 1;
  for (let j = 0; j < dim; j++) codes[at + j] = Math.round(v[from + j]! / scale);
  return scale;
}

export interface Hit { readonly id: number; readonly score: number }

export class VectorIndex {
  private readonly segments: Segment[] = [];
  private open: { ids: Int32Array; scales: Float32Array; codes: Int8Array; count: number } | null = null;

  constructor(readonly dim: number) {}

  get size(): number {
    return this.segments.reduce((n, s) => n + s.count, 0) + (this.open?.count ?? 0);
  }
  get bytes(): number {
    return this.size * (this.dim + 8);
  }
  /** Committed (full) segments, in order. */
  get sealed(): readonly Segment[] {
    return this.segments;
  }

  /** Adds a segment read back from storage. */
  adopt(segment: Segment): void {
    if (this.open?.count) throw new Error("adopt after add");
    this.segments.push(segment);
  }

  /** Appends `vectors` (row-major, normalised) for `ids`; returns segments that became full. */
  add(ids: ArrayLike<number>, vectors: Float32Array): Segment[] {
    const sealed: Segment[] = [];
    for (let i = 0; i < ids.length; i++) {
      if (!this.open) this.open = { ids: new Int32Array(SEGMENT_SIZE), scales: new Float32Array(SEGMENT_SIZE), codes: new Int8Array(SEGMENT_SIZE * this.dim), count: 0 };
      const o = this.open;
      o.ids[o.count] = ids[i]!;
      o.scales[o.count] = quantize(vectors, i * this.dim, this.dim, o.codes, o.count * this.dim);
      if (++o.count === SEGMENT_SIZE) { const s = { ...o }; this.segments.push(s); sealed.push(s); this.open = null; }
    }
    return sealed;
  }

  /** The partly filled last segment, as a segment (for a final commit). */
  tail(): Segment | null {
    const o = this.open;
    return o && o.count ? { ids: o.ids.slice(0, o.count), scales: o.scales.slice(0, o.count), codes: o.codes.slice(0, o.count * this.dim), count: o.count } : null;
  }

  /** Similarity of `q` to the vector of message `id`, or null when it has none (not indexable, or not indexed yet). */
  score(q: Float32Array, id: number): number | null {
    const dim = this.dim;
    const at = (s: { ids: Int32Array; scales: Float32Array; codes: Int8Array; count: number }) => {
      // Ids ascend within a segment and across segments.
      let lo = 0, hi = s.count - 1;
      if (hi < 0 || id < s.ids[0]! || id > s.ids[hi]!) return null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1, v = s.ids[mid]!;
        if (v === id) {
          let dot = 0;
          for (let j = 0, base = mid * dim; j < dim; j++) dot += q[j]! * s.codes[base + j]!;
          return dot * s.scales[mid]!;
        }
        if (v < id) lo = mid + 1; else hi = mid - 1;
      }
      return null;
    };
    for (const s of this.segments) { const r = at(s); if (r !== null) return r; }
    return this.open ? at(this.open) : null;
  }

  /** The `k` vectors most similar to `q` (normalised, float) among ids that pass `keep`, best first. */
  search(q: Float32Array, k: number, keep: (id: number) => boolean = () => true): Hit[] {
    const dim = this.dim;
    const top: Hit[] = [];
    const consider = (s: { ids: Int32Array; scales: Float32Array; codes: Int8Array; count: number }) => {
      for (let i = 0; i < s.count; i++) {
        const id = s.ids[i]!;
        if (!keep(id)) continue;
        let dot = 0;
        const base = i * dim;
        for (let j = 0; j < dim; j++) dot += q[j]! * s.codes[base + j]!;
        const score = dot * s.scales[i]!;
        if (top.length < k) { top.push({ id, score }); if (top.length === k) top.sort((a, b) => b.score - a.score); }
        else if (score > top[k - 1]!.score) {
          // Insert in order; k is small (a few hundred).
          let at = k - 1;
          while (at > 0 && top[at - 1]!.score < score) { top[at] = top[at - 1]!; at--; }
          top[at] = { id, score };
        }
      }
    };
    for (const s of this.segments) consider(s);
    if (this.open) consider(this.open);
    return top.sort((a, b) => b.score - a.score || a.id - b.id);
  }
}

/** Segment <-> bytes: ids (int32), scales (float32), codes (int8), after a 12-byte header. */
export function encodeSegment(s: Segment, dim: number): Uint8Array {
  const out = new Uint8Array(12 + s.count * (8 + dim));
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x57415331, true); // "WAS1"
  view.setUint32(4, s.count, true);
  view.setUint32(8, dim, true);
  out.set(new Uint8Array(s.ids.buffer, s.ids.byteOffset, s.count * 4), 12);
  out.set(new Uint8Array(s.scales.buffer, s.scales.byteOffset, s.count * 4), 12 + s.count * 4);
  out.set(new Uint8Array(s.codes.buffer, s.codes.byteOffset, s.count * dim), 12 + s.count * 8);
  return out;
}

export function decodeSegment(bytes: Uint8Array, dim: number): Segment | null {
  if (bytes.byteLength < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(4, true);
  if (view.getUint32(0, true) !== 0x57415331 || view.getUint32(8, true) !== dim || bytes.byteLength !== 12 + count * (8 + dim)) return null;
  const copy = bytes.slice(12);
  return {
    count,
    ids: new Int32Array(copy.buffer, 0, count),
    scales: new Float32Array(copy.buffer, count * 4, count),
    codes: new Int8Array(copy.buffer, count * 8, count * dim),
  };
}
