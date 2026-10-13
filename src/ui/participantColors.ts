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

export function participantColor(id: string): string {
  return `var(--participant-${participantColorIndex(id)})`;
}
