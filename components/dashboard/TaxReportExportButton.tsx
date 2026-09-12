"use client";

import { useState } from "react";

interface TaxReportExportButtonProps {
  /** Years offered in the picker, newest first. */
  years: number[];
  /** Year selected initially. Defaults to the newest offered. */
  defaultYear?: number;
}

type Status = "idle" | "downloading" | "empty" | "error";

/**
 * Downloads the lender's interest-income CSV for a chosen tax year (Issue #271).
 *
 * The file is generated server-side (`/api/lender/tax-report?format=csv`) rather
 * than in the browser, because the report needs repayment rows the lender cannot
 * read directly under RLS.
 */
export function TaxReportExportButton({ years, defaultYear }: TaxReportExportButtonProps) {
  const options = years.length > 0 ? years : [new Date().getFullYear()];
  const [year, setYear] = useState<string>(String(defaultYear ?? options[0]));
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const handleExport = async () => {
    setStatus("downloading");
    setMessage("");

    try {
      const response = await fetch(
        `/api/lender/tax-report?format=csv&year=${encodeURIComponent(year)}`
      );

      if (!response.ok) {
        let detail = `Export failed (${response.status})`;
        try {
          const body = await response.json();
          if (body?.error) detail = String(body.error);
        } catch {
          // Non-JSON error body — keep the status-code message.
        }
        throw new Error(detail);
      }

      const rowCount = Number(response.headers.get("X-Report-Rows") ?? "0");

      // An empty CSV is a valid file, but silently downloading a header-only
      // one looks like the button is broken. Say so instead.
      if (rowCount === 0) {
        setStatus("empty");
        setMessage(
          year === "all"
            ? "No interest earned yet — nothing to export."
            : `No interest earned in ${year}.`
        );
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `trustlend-tax-report-${year}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setStatus("idle");
      setMessage(`Exported ${rowCount} row${rowCount === 1 ? "" : "s"}.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Export failed");
    }
  };

  const busy = status === "downloading";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", alignItems: "flex-end" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        <label htmlFor="tax-report-year" style={{ fontSize: "0.78rem", color: "var(--fg-muted)", fontWeight: 600 }}>
          Tax year
        </label>

        <select
          id="tax-report-year"
          value={year}
          disabled={busy}
          onChange={(event) => {
            setYear(event.target.value);
            setStatus("idle");
            setMessage("");
          }}
          style={{
            padding: "0.4rem 0.6rem",
            borderRadius: "0.4rem",
            border: "1px solid color-mix(in srgb, var(--fg) 15%, transparent)",
            background: "var(--surface)",
            color: "var(--fg)",
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {options.map((option) => (
            <option key={option} value={String(option)}>
              {option}
            </option>
          ))}
          <option value="all">All years</option>
        </select>

        <button
          type="button"
          onClick={handleExport}
          disabled={busy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.45rem 0.9rem",
            borderRadius: "0.4rem",
            background: busy ? "var(--fg-muted)" : "var(--fg)",
            color: "var(--fg)",
            border: "none",
            fontWeight: 600,
            fontSize: "0.8rem",
            cursor: busy ? "not-allowed" : "pointer",
            transition: "background 0.2s",
          }}
        >
          <span aria-hidden="true">⬇️</span>
          {busy ? "Preparing…" : "Export Tax CSV"}
        </button>
      </div>

      {message && (
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: "0.75rem",
            color: status === "error" ? "var(--danger)" : "var(--fg-muted)",
            textAlign: "right",
          }}
        >
          {message}
        </p>
      )}
    </div>
  );
}
