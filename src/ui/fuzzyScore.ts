const CONSECUTIVE_BONUS = 4;
const WORD_START_BONUS = 3;
const LENGTH_PENALTY = 0.01;

function normalized(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Scores `text` when it holds the query's letters in order; null when it does not. */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = normalized(query).replace(/\s/g, "");
  const haystack = normalized(text);
  let score = -haystack.length * LENGTH_PENALTY;
  let searchFrom = 0;
  let previous = -2;
  for (const letter of needle) {
    const found = haystack.indexOf(letter, searchFrom);
    if (found === -1) return null;
    const isConsecutive = found === previous + 1;
    const isWordStart = found === 0 || !/[a-z0-9]/.test(haystack[found - 1] ?? "");
    score += 1 + (isConsecutive ? CONSECUTIVE_BONUS : 0) + (isWordStart ? WORD_START_BONUS : 0);
    previous = found;
    searchFrom = found + 1;
  }
  return score;
}
