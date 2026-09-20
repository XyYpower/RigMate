import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/infra/db/client.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.RIGMATE_DB_PATH ?? "./data/rigmate.db",
  },
});
