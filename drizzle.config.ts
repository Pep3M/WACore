import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/storage/postgres-db.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
