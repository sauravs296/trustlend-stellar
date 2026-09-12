/**
 * lib/db/metadata.ts
 *
 * jsonb `metadata` columns come back from Drizzle as parsed objects. Rows
 * written by the old Supabase code were sometimes stored as a JSON *string*
 * inside the jsonb column, so readers must tolerate both shapes.
 */

export type Metadata = Record<string, unknown>;

export function readMetadata(raw: unknown): Metadata {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Metadata) : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" && !Array.isArray(raw) ? (raw as Metadata) : {};
}

/** Read one string field out of a metadata blob ("" when absent). */
export function metaString(raw: unknown, key: string): string {
  const value = readMetadata(raw)[key];
  return value === null || value === undefined ? "" : String(value);
}
