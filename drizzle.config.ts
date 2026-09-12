import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration.
 *
 *   npm run db:generate   # diff lib/db/schema.ts → new SQL migration in drizzle/
 *   npm run db:migrate    # apply pending migrations to DATABASE_URL
 *   npm run db:studio     # browse the database
 *
 * DATABASE_URL is only needed for migrate/studio, not for generate.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/trustlend",
  },
  strict: true,
  verbose: true,
});
