export interface ProfileError { line: number; column: number; reason: string }

export function changes(oldText: string, newText: string) {
  const before = oldText.split('\n'), after = newText.split('\n')
  let start = 0, end = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  while (end < before.length - start && end < after.length - start && before.at(-1-end) === after.at(-1-end)) end++
  return { start, before: before.slice(start, before.length-end), after: after.slice(start, after.length-end), tail: after.slice(after.length-end) }
}
