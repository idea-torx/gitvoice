import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const target = ".dev.vars";

if (existsSync(target)) {
  process.exit(0);
}

const token = randomBytes(24).toString("base64url");
const secret = randomBytes(24).toString("base64url");
const contents = [
  `ADMIN_TOKEN="${token}"`,
  `PORTAL_SECRET="${secret}"`,
  `GITHUB_TOKEN="optional-for-public-repos"`,
  `OPENAI_API_KEY="optional-alternative-provider"`,
  "",
].join("\n");

await writeFile(target, contents);
console.log("Created .dev.vars with a fresh ADMIN_TOKEN and PORTAL_SECRET.");
