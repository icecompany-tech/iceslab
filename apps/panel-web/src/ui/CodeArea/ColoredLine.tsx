export function ColoredLine({ line }: { line: string }) {
  return line.split(/("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null|\d+)\b)/g)
    .map((part,i,parts) => <span key={i} data-token={part.startsWith('"') ? (parts[i+1]?.trimStart().startsWith(':') ? 'key' : 'value') : undefined}>{part}</span>)
}

