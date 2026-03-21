/**
 * Simple multi-term AND matching for fuzzy filtering.
 * Split query on whitespace; each token must appear (case-insensitive) in the text.
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.map((_, i) => i);

  const tokens = q.split(/\s+/);
  const result: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const text = getText(items[i]).toLowerCase();
    if (tokens.every((t) => text.includes(t))) {
      result.push(i);
    }
  }

  return result;
}
