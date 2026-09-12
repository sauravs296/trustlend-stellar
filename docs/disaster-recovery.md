# Disaster Recovery — Database Backups

How TrustLend's PostgreSQL database is backed up, and how to restore it.

- **Schedule:** every day at **00:00 UTC**
- **Runner:** [`.github/workflows/db-backup.yml`](.github/workflows/db-backup.yml)
- **Script:** [`scripts/backup.sh`](scripts/backup.sh)
- **Destination:** `s3://$S3_BUCKET/backups/YYYY/MM/trustlend-<timestamp>.dump.enc`
- **Encryption:** AES-256-CBC (PBKDF2, 600k iterations) applied **before** upload
- **Retention:** 30 days by default (`BACKUP_RETENTION_DAYS`)

---

## 1. What the nightly job does

1. **Dump** — `pg_dump --format=custom --no-owner --no-privileges`, a full dump of
   schema *and* data.
2. **Verify** — rejects a dump below `BACKUP_MIN_BYTES`, then runs
   `pg_restore --list` to confirm the archive is well-formed.
3. **Encrypt** — AES-256-CBC with PBKDF2. The passphrase is passed via the
   environment, never as a command-line argument.
4. **Verify again** — decrypts the artifact and compares its SHA-256 against the
   original dump, so a wrong or rotated key is caught on backup night rather
   than during an outage.
5. **Upload** — `aws s3 cp --sse AES256`, then `head-object` to confirm the
   stored object's size matches what was sent.
6. **Prune** — deletes backups older than the retention window.

The plaintext dump only ever exists inside a `mktemp -d` directory that is
removed by an `EXIT` trap, on success or failure.

If a scheduled run fails, the workflow opens (or comments on) a GitHub issue
labelled `backup-failure`.

---

## 2. One-time setup

### Repository secrets

| Secret | Value |
|---|---|
| `DATABASE_URL` | Direct Postgres connection string (**port 5432**, not the pooler) |
| `BACKUP_ENCRYPTION_KEY` | Long random passphrase — also store it in the team password manager |
| `S3_BUCKET` | Destination bucket name, no `s3://` prefix |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credentials for a backup-only IAM user |

Optional repository **variables**: `AWS_REGION` (default `us-east-1`),
`PG_MAJOR` (default `17`), `BACKUP_RETENTION_DAYS`, `BACKUP_EXCLUDE_SCHEMAS`.

> ⚠️ **`BACKUP_ENCRYPTION_KEY` is not recoverable.** Lose it and every backup
> becomes permanently unreadable. Rotating it does not re-encrypt existing
> objects, so keep the old key for as long as you keep dumps encrypted with it.

### Bucket

Put the bucket in a **different AWS account, or at minimum a different region**,
from the database — a backup that shares a failure domain with production is not
an off-site backup.

```bash
aws s3api create-bucket --bucket trustlend-backups --region us-east-1
aws s3api put-bucket-versioning --bucket trustlend-backups \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket trustlend-backups \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

A lifecycle policy is more robust than the script's prune, because it keeps
working even if the job stops running:

```bash
aws s3api put-bucket-lifecycle-configuration --bucket trustlend-backups \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "expire-old-backups",
      "Filter": {"Prefix": "backups/"},
      "Status": "Enabled",
      "Expiration": {"Days": 30}
    }]
  }'
```

### IAM

The backup user needs only these actions on the backup prefix:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::trustlend-backups/backups/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::trustlend-backups"
    }
  ]
}
```

Prefer GitHub's OIDC provider over long-lived access keys if you can — it
removes the static credentials from repository secrets entirely.

---

## 3. Restore

### 3.1 Fetch and decrypt

```bash
# List available backups, newest last
aws s3 ls s3://$S3_BUCKET/backups/ --recursive

# Download the one you want
aws s3 cp s3://$S3_BUCKET/backups/2026/08/trustlend-20260828T000000Z.dump.enc .

# Decrypt (prompts for the passphrase; must match the key used that night)
BACKUP_ENCRYPTION_KEY='...' openssl enc -d -aes-256-cbc \
  -pbkdf2 -iter 600000 -md sha512 \
  -in trustlend-20260828T000000Z.dump.enc \
  -out restore.dump \
  -pass env:BACKUP_ENCRYPTION_KEY

# Confirm the archive is intact before touching any database
pg_restore --list restore.dump | head
```

### 3.2 Restore into a database

**Always restore into a scratch database first** and inspect it. Never point a
restore at production until you have confirmed the contents.

```bash
createdb trustlend_restore
pg_restore --dbname="postgresql://.../trustlend_restore" \
  --no-owner --no-privileges --jobs=4 restore.dump
```

To restore over an existing database, add `--clean --if-exists`. This **drops
objects before recreating them** — take a fresh dump of the current state first.

```bash
pg_restore --dbname="$DATABASE_URL" \
  --clean --if-exists --no-owner --no-privileges restore.dump
```

Restoring a single table:

```bash
pg_restore --dbname="$DATABASE_URL" --data-only --table=loans restore.dump
```

### 3.3 Supabase notes

- Dumps are taken with `--no-owner --no-privileges` so they restore into a
  project whose roles differ from production — which is the normal case when
  restoring into a fresh project.
- A full dump includes Supabase-managed schemas (`auth`, `storage`, …).
  Restoring those into a *new* project can conflict with what the platform
  provisions. If you hit that, restore only what you need:
  `pg_restore --schema=public …`.
- If `pg_dump` fails on a platform-managed schema (`vault`, `pgsodium`), set the
  `BACKUP_EXCLUDE_SCHEMAS` repository variable, e.g. `vault,pgsodium`.
- RLS policies live in [supabase/rls-policies.sql](supabase/rls-policies.sql) and
  are captured by the dump, but re-applying that file is a good sanity check
  after a restore into a new project.

---

## 4. Testing

Run the whole pipeline without writing to S3:

```bash
BACKUP_DRY_RUN=1 bash scripts/backup.sh
```

This dumps, verifies, encrypts and verifies the decryption round-trip, then
stops before the upload. The workflow also exposes this via
**Actions → Automated DB Backup → Run workflow → dry run**.

Automated coverage for the script's safety properties (missing config is
rejected, empty and corrupt dumps are refused, no plaintext survives) lives in
[`__tests__/scripts/backup-script.test.ts`](__tests__/scripts/backup-script.test.ts).

### Quarterly restore drill

Automated checks prove the *artifact* is well-formed; they cannot prove the
database is recoverable. Once a quarter, restore the latest backup into a
scratch database and confirm row counts on the core tables:

```sql
SELECT 'profiles' t, count(*) FROM profiles
UNION ALL SELECT 'loans', count(*) FROM loans;
```

Record the date and result in the PR or an issue. **An untested backup is a
hypothesis, not a backup.**

---

## 5. Known limitations

- **Scheduling is best-effort.** GitHub may delay scheduled workflows under
  load, so the run time is approximate. GitHub also disables scheduled workflows
  in repositories with no activity for 60 days — if the repo goes quiet, confirm
  the schedule is still enabled.
- **Recovery point objective is 24 hours.** Up to a day of writes can be lost.
  Supabase's own point-in-time recovery is the tool for a tighter RPO; this job
  is the independent, off-site copy that survives losing the Supabase project.
- **Restores are manual.** There is deliberately no automated restore path — an
  automated process that can overwrite production is a bigger risk than the
  minutes it saves.
