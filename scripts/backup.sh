#!/usr/bin/env bash
#
# scripts/backup.sh — encrypted daily PostgreSQL backup → Amazon S3.
#
# Takes a full logical dump of the database, encrypts it locally with
# AES-256 before it ever leaves the machine, uploads it to S3, verifies the
# uploaded object, and prunes backups past the retention window.
#
# Restore instructions live in docs/disaster-recovery.md. A backup nobody has
# restored is a hypothesis, not a backup — please run the quarterly drill.
#
# Usage:
#   bash scripts/backup.sh              # dump, encrypt, upload
#   BACKUP_DRY_RUN=1 bash scripts/backup.sh   # everything except S3 writes
#
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
# Sourced from the environment (CI secrets) or, for local runs, a .env file.
# Unlike the previous version this is optional: in CI there is no .env, and
# `source`-ing a missing file under `set -e` aborted the script before it took
# a single backup.
if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

# Required.
#   DATABASE_URL           postgres://... connection string. On Neon use the
#                          DIRECT (non-pooler) host, or set BACKUP_DATABASE_URL
#                          to it and keep DATABASE_URL pooled for the app.
#   BACKUP_ENCRYPTION_KEY  passphrase for AES-256; store in a password manager,
#                          NOT only in CI — losing it makes every backup useless
#   S3_BUCKET              destination bucket name (no s3:// prefix)
# Optional.
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_DRY_RUN="${BACKUP_DRY_RUN:-0}"
# Comma-separated schemas to skip. Empty by default: a backup missing data is
# worse than one carrying extra. See docs/disaster-recovery.md for Neon notes.
BACKUP_EXCLUDE_SCHEMAS="${BACKUP_EXCLUDE_SCHEMAS:-}"
# Minimum plausible dump size; guards against silently archiving an empty file.
BACKUP_MIN_BYTES="${BACKUP_MIN_BYTES:-1024}"

log()  { printf '%s %s\n' "[$(date -u +%H:%M:%S)]" "$*"; }
fail() { printf '%s ERROR: %s\n' "[$(date -u +%H:%M:%S)]" "$*" >&2; exit 1; }

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "$name is not set. See .env.example and docs/disaster-recovery.md."
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is not installed but is required."
}

require_env DATABASE_URL
require_env BACKUP_ENCRYPTION_KEY
require_env S3_BUCKET

require_cmd pg_dump
require_cmd pg_restore
require_cmd openssl
require_cmd sha256sum
[[ "$BACKUP_DRY_RUN" == "1" ]] || require_cmd aws

# ── Working directory ─────────────────────────────────────────────────────────
# Everything happens inside a private temp dir that is removed on ANY exit,
# success or failure. The plaintext dump must never outlive this script — the
# previous version deleted the encrypted file and left the plaintext behind.
WORKDIR="$(mktemp -d)"
chmod 700 "$WORKDIR"
cleanup() {
  local code=$?
  rm -rf "$WORKDIR"
  exit "$code"
}
trap cleanup EXIT INT TERM

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$WORKDIR/trustlend-${TIMESTAMP}.dump"
ENCRYPTED_FILE="${DUMP_FILE}.enc"
# Date-partitioned so S3 lifecycle rules and humans can both navigate it.
S3_KEY="${BACKUP_S3_PREFIX}/$(date -u +%Y/%m)/trustlend-${TIMESTAMP}.dump.enc"
S3_URI="s3://${S3_BUCKET}/${S3_KEY}"

# ── 1. Dump ───────────────────────────────────────────────────────────────────
# Custom format (-Fc): compressed, and restorable selectively/in parallel with
# pg_restore. --no-owner/--no-privileges keep it restorable into a project whose
# roles differ from production, which is the usual disaster-recovery situation.
#
# NOTE: this is a FULL dump. It previously ran with --schema-only, which backed
# up the table definitions and none of the data.
log "1/6 Dumping database (full, custom format)…"
dump_args=(
  --format=custom
  --no-owner
  --no-privileges
  --file="$DUMP_FILE"
)
if [[ -n "$BACKUP_EXCLUDE_SCHEMAS" ]]; then
  while IFS= read -r schema; do
    [[ -n "$schema" ]] && dump_args+=(--exclude-schema="$schema")
  done < <(tr ',' '\n' <<<"$BACKUP_EXCLUDE_SCHEMAS" | tr -d ' ')
fi
pg_dump "${BACKUP_DATABASE_URL:-$DATABASE_URL}" "${dump_args[@]}"

# ── 2. Verify the dump ────────────────────────────────────────────────────────
# A truncated or empty archive uploads just as happily as a good one, so check
# before we treat it as a backup.
log "2/6 Verifying dump integrity…"
dump_bytes="$(wc -c <"$DUMP_FILE" | tr -d ' ')"
if (( dump_bytes < BACKUP_MIN_BYTES )); then
  fail "Dump is only ${dump_bytes} bytes (minimum ${BACKUP_MIN_BYTES}). Refusing to upload."
fi
# pg_restore --list parses the archive's table of contents; it fails loudly on a
# corrupt or truncated file without touching any database.
pg_restore --list "$DUMP_FILE" >/dev/null || fail "Dump failed pg_restore validation."
log "    Dump OK (${dump_bytes} bytes)."

# ── 3. Encrypt ────────────────────────────────────────────────────────────────
# AES-256-CBC with PBKDF2. The passphrase is passed via the environment rather
# than `-k` on the command line, which would expose it in the process list to
# any other user on the machine.
log "3/6 Encrypting (AES-256-CBC, PBKDF2)…"
BACKUP_ENCRYPTION_KEY="$BACKUP_ENCRYPTION_KEY" openssl enc -aes-256-cbc \
  -salt -pbkdf2 -iter 600000 -md sha512 \
  -in "$DUMP_FILE" -out "$ENCRYPTED_FILE" \
  -pass env:BACKUP_ENCRYPTION_KEY

# ── 4. Verify the encryption round-trips ──────────────────────────────────────
# Proves the artifact is decryptable with this key before we rely on it and
# throw the plaintext away. Catches a wrong/rotated key on backup night rather
# than during an outage.
log "4/6 Verifying decryption round-trip…"
plain_sum="$(sha256sum <"$DUMP_FILE" | cut -d' ' -f1)"
roundtrip_sum="$(
  BACKUP_ENCRYPTION_KEY="$BACKUP_ENCRYPTION_KEY" openssl enc -d -aes-256-cbc \
    -pbkdf2 -iter 600000 -md sha512 \
    -in "$ENCRYPTED_FILE" -pass env:BACKUP_ENCRYPTION_KEY | sha256sum | cut -d' ' -f1
)"
if [[ "$plain_sum" != "$roundtrip_sum" ]]; then
  fail "Decrypted backup does not match the original dump. Refusing to upload."
fi
log "    Round-trip OK (sha256 ${plain_sum:0:16}…)."

# ── 5. Upload ─────────────────────────────────────────────────────────────────
if [[ "$BACKUP_DRY_RUN" == "1" ]]; then
  log "5/6 DRY RUN — skipping upload to ${S3_URI}"
  log "6/6 DRY RUN — skipping retention prune"
  log "Dry run complete. Encrypted artifact was built and verified, not uploaded."
  exit 0
fi

# --sse AES256 adds server-side encryption at rest on top of the client-side
# encryption above; the object is already ciphertext before it leaves here.
log "5/6 Uploading to ${S3_URI}…"
aws s3 cp "$ENCRYPTED_FILE" "$S3_URI" --sse AES256 --only-show-errors

# Confirm S3 actually holds what we sent, rather than trusting the exit code.
encrypted_bytes="$(wc -c <"$ENCRYPTED_FILE" | tr -d ' ')"
remote_bytes="$(aws s3api head-object --bucket "$S3_BUCKET" --key "$S3_KEY" \
  --query 'ContentLength' --output text)"
if [[ "$encrypted_bytes" != "$remote_bytes" ]]; then
  fail "Upload size mismatch: local ${encrypted_bytes} vs remote ${remote_bytes}."
fi
log "    Uploaded and verified (${remote_bytes} bytes)."

# ── 6. Retention ──────────────────────────────────────────────────────────────
# An S3 lifecycle policy on the bucket is the more robust way to do this (it
# keeps working even if this job stops running) — see docs/disaster-recovery.md.
# This prune is a self-contained backstop for buckets without one.
log "6/6 Pruning backups older than ${BACKUP_RETENTION_DAYS} days…"
# No trailing 'Z': S3 reports LastModified as "...T00:00:00+00:00", and this is a
# lexicographic JMESPath comparison. Leaving the zone suffix off keeps the
# date-time prefix authoritative instead of comparing 'Z' against '+'.
cutoff="$(date -u -d "${BACKUP_RETENTION_DAYS} days ago" +%Y-%m-%dT%H:%M:%S 2>/dev/null \
  || date -u -v-"${BACKUP_RETENTION_DAYS}"d +%Y-%m-%dT%H:%M:%S)"

pruned=0
while IFS= read -r old_key; do
  [[ -z "$old_key" || "$old_key" == "None" ]] && continue
  # Never let the prune step delete the backup we just made.
  [[ "$old_key" == "$S3_KEY" ]] && continue
  aws s3 rm "s3://${S3_BUCKET}/${old_key}" --only-show-errors
  pruned=$((pruned + 1))
done < <(
  aws s3api list-objects-v2 \
    --bucket "$S3_BUCKET" \
    --prefix "${BACKUP_S3_PREFIX}/" \
    --query "Contents[?LastModified<'${cutoff}'].Key" \
    --output text 2>/dev/null | tr '\t' '\n'
)
log "    Pruned ${pruned} expired backup(s)."

log "✅ Backup complete: ${S3_URI}"
