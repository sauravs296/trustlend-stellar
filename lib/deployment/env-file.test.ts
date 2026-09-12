import { describe, expect, it } from "vitest";
import {
  formatEnvFile,
  parseEnvFile,
  quoteEnvValue,
  upsertEnvVars,
} from "./env-file";

const CONTRACT_ID = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";

// ─── parseEnvFile ─────────────────────────────────────────────────────────────

describe("parseEnvFile", () => {
  it("reads simple assignments", () => {
    expect(parseEnvFile("FOO=bar\nBAZ=qux")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores comments and blank lines", () => {
    const env = parseEnvFile("# a comment\n\nFOO=bar\n   \n# another\n");

    expect(env).toEqual({ FOO: "bar" });
  });

  it("keeps empty values", () => {
    expect(parseEnvFile("EMPTY=")).toEqual({ EMPTY: "" });
  });

  it("strips matching surrounding quotes", () => {
    expect(parseEnvFile(`A="quoted"\nB='single'`)).toEqual({
      A: "quoted",
      B: "single",
    });
  });

  it("handles the export prefix", () => {
    expect(parseEnvFile("export FOO=bar")).toEqual({ FOO: "bar" });
  });

  it("keeps the last value when a key repeats", () => {
    expect(parseEnvFile("FOO=first\nFOO=second")).toEqual({ FOO: "second" });
  });

  it("handles CRLF line endings", () => {
    expect(parseEnvFile("FOO=bar\r\nBAZ=qux")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("keeps '=' inside a value", () => {
    expect(parseEnvFile("KEY=a=b=c")).toEqual({ KEY: "a=b=c" });
  });
});

// ─── quoteEnvValue ────────────────────────────────────────────────────────────

describe("quoteEnvValue", () => {
  it("leaves a contract id unquoted", () => {
    expect(quoteEnvValue(CONTRACT_ID)).toBe(CONTRACT_ID);
  });

  it("quotes values containing whitespace", () => {
    expect(quoteEnvValue("two words")).toBe('"two words"');
  });

  it("quotes values containing a comment character", () => {
    // Unquoted, everything from '#' would be read as a trailing comment.
    expect(quoteEnvValue("abc#def")).toBe('"abc#def"');
  });

  it("keeps an empty value empty rather than writing two quotes", () => {
    expect(quoteEnvValue("")).toBe("");
  });
});

// ─── upsertEnvVars ────────────────────────────────────────────────────────────

describe("upsertEnvVars", () => {
  it("updates an existing key in place", () => {
    const result = upsertEnvVars("FOO=old\nBAR=keep", { FOO: "new" });

    expect(result).toBe("FOO=new\nBAR=keep");
  });

  it("fills in a key that was declared but left empty", () => {
    // .env.example ships these keys blank; a deploy should fill them, not
    // append a second copy.
    const result = upsertEnvVars(
      "NEXT_PUBLIC_LENDING_CONTRACT_ID=",
      { NEXT_PUBLIC_LENDING_CONTRACT_ID: CONTRACT_ID }
    );

    expect(result).toBe(`NEXT_PUBLIC_LENDING_CONTRACT_ID=${CONTRACT_ID}`);
    expect(result.match(/NEXT_PUBLIC_LENDING_CONTRACT_ID/g)).toHaveLength(1);
  });

  it("preserves unrelated keys and their comments", () => {
    const original = [
      "# Database",
      "SESSION_SECRET=super-secret",
      "",
      "# Contracts",
      "NEXT_PUBLIC_LENDING_CONTRACT_ID=old",
    ].join("\n");

    const result = upsertEnvVars(original, {
      NEXT_PUBLIC_LENDING_CONTRACT_ID: CONTRACT_ID,
    });

    expect(result).toContain("# Database");
    expect(result).toContain("SESSION_SECRET=super-secret");
    expect(result).toContain("# Contracts");
    expect(result).toContain(`NEXT_PUBLIC_LENDING_CONTRACT_ID=${CONTRACT_ID}`);
    expect(result).not.toContain("=old");
  });

  it("appends keys that are not present yet", () => {
    const result = upsertEnvVars("EXISTING=1", { NEW_KEY: "value" });

    expect(result).toContain("EXISTING=1");
    expect(result).toContain("NEW_KEY=value");
  });

  it("groups appended keys under one section header", () => {
    const result = upsertEnvVars(
      "EXISTING=1",
      { A: "1", B: "2" },
      { sectionHeader: "# contracts" }
    );

    expect(result.match(/# contracts/g)).toHaveLength(1);
  });

  it("handles an empty file", () => {
    const result = upsertEnvVars("", { FOO: "bar" }, { sectionHeader: "# head" });

    expect(result).toBe("# head\nFOO=bar\n");
  });

  it("does not leave a run of blank lines before the appended block", () => {
    const result = upsertEnvVars(
      "EXISTING=1\n\n\n\n",
      { NEW: "2" },
      { sectionHeader: "# head" }
    );

    expect(result).toBe("EXISTING=1\n\n# head\nNEW=2\n");
  });

  it("preserves the export prefix when updating", () => {
    expect(upsertEnvVars("export FOO=old", { FOO: "new" })).toBe("export FOO=new");
  });

  it("preserves indentation when updating", () => {
    expect(upsertEnvVars("  FOO=old", { FOO: "new" })).toBe("  FOO=new");
  });

  it("updates every occurrence of a repeated key", () => {
    // A stale earlier assignment must not survive to shadow the new value.
    const result = upsertEnvVars("FOO=one\nBAR=x\nFOO=two", { FOO: "three" });

    expect(result).toBe("FOO=three\nBAR=x\nFOO=three");
    expect(parseEnvFile(result).FOO).toBe("three");
  });

  it("preserves CRLF line endings", () => {
    const result = upsertEnvVars("FOO=old\r\nBAR=keep", { FOO: "new" });

    expect(result).toBe("FOO=new\r\nBAR=keep");
  });

  it("returns the content untouched when there is nothing to update", () => {
    expect(upsertEnvVars("FOO=bar", {})).toBe("FOO=bar");
  });

  it("does not treat a commented-out key as an assignment", () => {
    const result = upsertEnvVars(
      "# FOO=commented",
      { FOO: "value" },
      { sectionHeader: "# head" }
    );

    expect(result).toContain("# FOO=commented");
    expect(result).toContain("FOO=value");
  });

  it("round-trips through the parser", () => {
    const updates = {
      NEXT_PUBLIC_LENDING_CONTRACT_ID: CONTRACT_ID,
      NEXT_PUBLIC_ADMIN_ADDRESS: "GABC",
    };

    const parsed = parseEnvFile(upsertEnvVars("OTHER=1", updates));

    expect(parsed).toMatchObject({ ...updates, OTHER: "1" });
  });

  it("keeps secrets intact across a realistic merge", () => {
    const original = [
      "DATABASE_URL=postgres://user:pw@ep-xyz.neon.tech/db",
      "SESSION_SECRET=eyJhbGciOi.secret.value",
      "ADMIN_SECRET_KEY=SXXXXXXX",
      "NEXT_PUBLIC_LENDING_CONTRACT_ID=",
    ].join("\n");

    const parsed = parseEnvFile(
      upsertEnvVars(original, {
        NEXT_PUBLIC_LENDING_CONTRACT_ID: CONTRACT_ID,
        NEXT_PUBLIC_ADMIN_ADDRESS: "GADMIN",
      })
    );

    expect(parsed.SESSION_SECRET).toBe("eyJhbGciOi.secret.value");
    expect(parsed.ADMIN_SECRET_KEY).toBe("SXXXXXXX");
    expect(parsed.NEXT_PUBLIC_LENDING_CONTRACT_ID).toBe(CONTRACT_ID);
    expect(parsed.NEXT_PUBLIC_ADMIN_ADDRESS).toBe("GADMIN");
  });
});

// ─── formatEnvFile ────────────────────────────────────────────────────────────

describe("formatEnvFile", () => {
  it("renders a standalone file with a trailing newline", () => {
    expect(formatEnvFile({ A: "1", B: "2" })).toBe("A=1\nB=2\n");
  });

  it("puts the header first, followed by a blank line", () => {
    expect(formatEnvFile({ A: "1" }, "# header")).toBe("# header\n\nA=1\n");
  });

  it("produces output the parser can read back", () => {
    const vars = { NEXT_PUBLIC_LENDING_CONTRACT_ID: CONTRACT_ID };

    expect(parseEnvFile(formatEnvFile(vars, "# header"))).toEqual(vars);
  });
});
