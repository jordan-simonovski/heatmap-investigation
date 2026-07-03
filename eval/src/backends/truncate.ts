export function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return s.slice(0, cap) + `\n…[truncated ${s.length - cap} chars]`;
}
