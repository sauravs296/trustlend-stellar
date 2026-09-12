/**
 * Reading and rewriting `.env` files in place (Issue #270).
 *
 * The testnet deployment CLI writes freshly deployed contract IDs straight into
 * the developer's `.env.local`. That file usually already holds the database URL,
 * API secrets and hand-written comments, so the merge has to be surgical:
 * update the values we own, leave every other byte alone.
 */

/** Key an env assignment must match: `KEY=`, optionally `export KEY=`. */
const ASSIGNMENT = /^(\s*)(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

const MANAGED_SECTION_TITLE = "Soroban Contract IDs";

/**
 * Parse an env file into a flat key/value map.
 *
 * Ignores comments and blank lines, strips matching surrounding quotes, and
 * keeps the last assignment when a key appears more than once — the same
 * precedence dotenv itself applies.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = ASSIGNMENT.exec(rawLine);
    if (!match) continue;

    env[match[2]] = unquote(match[3].trim());
  }

  return env;
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];

    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }

  return value;
}

/**
 * Quote a value only when it would otherwise be misread — whitespace, a `#`
 * that would start a comment, or an existing quote character.
 */
export function quoteEnvValue(value: string): string {
  if (value === "") return "";

  if (/[\s#'"]/.test(value)) {
    return `"${value.replace(/(["\\])/g, "\\$1")}"`;
  }

  return value;
}

export type UpsertOptions = {
  /** Comment placed above newly appended keys. Defaults to a dated header. */
  sectionHeader?: string;
};

/**
 * Merge `updates` into an env file's text.
 *
 * Keys that already exist are rewritten **in place**, preserving their position,
 * indentation, `export` prefix and the surrounding comments. Keys that do not
 * exist yet are appended together under one section header.
 *
 * A key present multiple times has every occurrence updated, so a stale earlier
 * assignment cannot shadow the new value depending on parser precedence.
 */
export function upsertEnvVars(
  content: string,
  updates: Record<string, string>,
  options: UpsertOptions = {}
): string {
  const entries = Object.entries(updates);

  if (entries.length === 0) {
    return content;
  }

  const pending = new Set(Object.keys(updates));
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);

  const rewritten = lines.map((line) => {
    const match = ASSIGNMENT.exec(line);
    if (!match) return line;

    const [, indent, key] = match;
    if (!(key in updates)) return line;

    pending.delete(key);
    const exportPrefix = /^\s*export\s+/.test(line) ? "export " : "";

    return `${indent}${exportPrefix}${key}=${quoteEnvValue(updates[key])}`;
  });

  if (pending.size === 0) {
    return rewritten.join(newline);
  }

  // Append whatever was not already in the file, under one header.
  const header = options.sectionHeader ?? defaultSectionHeader();
  const appended = [...pending].map(
    (key) => `${key}=${quoteEnvValue(updates[key])}`
  );

  // Exactly one blank line between the existing content and the new section.
  while (rewritten.length > 0 && rewritten[rewritten.length - 1].trim() === "") {
    rewritten.pop();
  }

  const block = rewritten.length > 0 ? ["", header, ...appended] : [header, ...appended];

  return [...rewritten, ...block].join(newline) + newline;
}

function defaultSectionHeader(): string {
  return `# ── ${MANAGED_SECTION_TITLE} (written by npm run deploy:testnet on ${new Date().toISOString()}) ──`;
}

/**
 * Render a standalone env file from scratch, for the `.env.contracts` artifact.
 */
export function formatEnvFile(
  vars: Record<string, string>,
  header?: string
): string {
  const lines = header ? [header, ""] : [];

  for (const [key, value] of Object.entries(vars)) {
    lines.push(`${key}=${quoteEnvValue(value)}`);
  }

  return lines.join("\n") + "\n";
}
