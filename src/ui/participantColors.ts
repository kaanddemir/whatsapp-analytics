/** Stable, theme-aware participant colours. Names/ids are never exposed by the hash. */
export const PARTICIPANT_COLOR_COUNT = 8;

export function participantColorIndex(id: string): number {
  // FNV-1a over Unicode code points: deterministic across sessions and list order.
  let hash = 0x811c9dc5;
  for (const character of id) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % PARTICIPANT_COLOR_COUNT;
}

/**
 * Colours for people drawn side by side: each keeps their stable colour unless
 * someone earlier in `ids` already holds it, and then takes the next free one.
 * Eight is the palette, so at most eight ids are told apart this way.
 */
export function distinctColorIndexes(ids: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const id of ids) {
    let color = participantColorIndex(id);
    for (let step = 0; step < PARTICIPANT_COLOR_COUNT && used.has(color); step++) color = (color + 1) % PARTICIPANT_COLOR_COUNT;
    used.add(color);
    out.set(id, color);
  }
  return out;
}

export function participantColor(id: string): string {
  return `var(--participant-${participantColorIndex(id)})`;
}
