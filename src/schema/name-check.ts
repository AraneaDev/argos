/**
 * Pre-flight checks of table/column names against the cached schema, plus the
 * fuzzy matching used to suggest corrections.
 */

export interface NameProblem {
  /** The wrong column as written (unquoted). */
  name: string;
  /** Known table it was qualified with; null for a bare column. */
  table: string | null;
  /** Known tables whose columns to list (cache keys). */
  inScope: string[];
  /** 0-based batch index, set by the batch handler. */
  statement?: number;
}

function normalize(name: string): string {
  const base = name.toLowerCase().replace(/_/g, '');
  return base.length > 1 && base.endsWith('s') ? base.slice(0, -1) : base;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** Closest candidates to `wrong`, best first; empty when nothing is close. */
export function suggest(wrong: string, candidates: string[], max = 3): string[] {
  const target = normalize(wrong);
  const limit = Math.max(1, Math.floor(target.length / 3));
  return candidates
    .map((candidate) => ({ candidate, score: levenshtein(target, normalize(candidate)) }))
    .filter((entry) => entry.score <= limit)
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map((entry) => entry.candidate);
}
