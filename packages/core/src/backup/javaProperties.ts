/**
 * A focused read/write implementation of Java's `java.util.Properties` text format — the format
 * `manifest.properties` and `appearance.properties` use inside the backup zip (the Kotlin code
 * writes them with `Properties.store()`). Scoped to the ASCII-safe keys/values the Android app
 * actually writes (see docs/backup-format.md); does not implement `\uXXXX` escaping for
 * non-ASCII content, since none of this app's property values use it.
 */

export function writeProperties(entries: Record<string, string>): Uint8Array {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    lines.push(`${escape(key, true)}=${escape(value, false)}`);
  }
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

export function readProperties(bytes: Uint8Array): Record<string, string> {
  const text = new TextDecoder("utf-8").decode(bytes);
  const result: Record<string, string> = {};
  const rawLines = text.split(/\r\n|\r|\n/);

  let pending = "";
  for (const rawLine of rawLines) {
    const line = pending + rawLine;
    pending = "";
    const trimmed = line.replace(/^[ \t\f]+/, "");
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      continue;
    }
    if (endsWithOddBackslashes(line)) {
      pending = line.slice(0, -1);
      continue;
    }
    const parsed = parseLine(trimmed);
    if (parsed) {
      result[parsed.key] = parsed.value;
    }
  }
  return result;
}

function endsWithOddBackslashes(line: string): boolean {
  let count = 0;
  for (let i = line.length - 1; i >= 0 && line[i] === "\\"; i--) count++;
  return count % 2 === 1;
}

function parseLine(line: string): { key: string; value: string } | null {
  let i = 0;
  while (i < line.length && !/[=:\s]/.test(line[i]!)) {
    if (line[i] === "\\") i++; // skip escaped char
    i++;
  }
  const rawKey = line.slice(0, i);
  let rest = line.slice(i).replace(/^[ \t\f]+/, "");
  if (rest.startsWith("=") || rest.startsWith(":")) {
    rest = rest.slice(1).replace(/^[ \t\f]+/, "");
  }
  return { key: unescape(rawKey), value: unescape(rest) };
}

function escape(value: string, isKey: boolean): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "=" || ch === ":" || ch === "#" || ch === "!") out += `\\${ch}`;
    else if (isKey && ch === " ") out += "\\ ";
    else if (!isKey && ch === " " && i === 0) out += "\\ ";
    else out += ch;
  }
  return out;
}

function unescape(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === "\\" && i + 1 < value.length) {
      const next = value[i + 1]!;
      i++;
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else out += next;
    } else {
      out += ch;
    }
  }
  return out;
}
