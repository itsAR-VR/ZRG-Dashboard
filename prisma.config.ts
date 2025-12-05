// Prisma configuration file
// Learn more: https://pris.ly/d/prisma-config
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Load .env.local first (Next.js standard), then .env as fallback
config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Use DIRECT_URL for CLI commands (db push, migrations, introspection)
    // This must be a non-pooled connection (Session Pooler port 5432)
    url: env("DIRECT_URL"),
  },
});
