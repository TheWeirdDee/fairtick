import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// Existing process environment wins; local secrets are never printed.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) loadEnvFile(file);
}
