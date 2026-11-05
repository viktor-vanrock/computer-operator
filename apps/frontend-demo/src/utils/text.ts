export function extractTitle(description: string, maxLen = 55): string {
  const firstSentence = description.split(/[.!?]/)[0]?.trim() ?? description;
  if (firstSentence.length <= maxLen) return firstSentence;
  return `${firstSentence.slice(0, maxLen - 3)}...`;
}
