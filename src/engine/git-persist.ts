/**
 * HFT Cash v6 - Git Persistence
 * Cost-free cloud persistence: auto-commit db.json to git.
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "../..");

export function persistToGit(): void {
  if (process.env.SKIP_GIT_PERSIST === "1") return;

  try {
    const cwd = PROJECT_ROOT;
    execSync("git add data/db.json", { cwd });
    const status = execSync("git status --porcelain data/db.json", { cwd }).toString().trim();
    if (!status) return;

    const msg = `chore: persist db.json [${new Date().toISOString().slice(0, 19)}]`;
    execSync(`git commit -m "${msg}"`, { cwd });

    if (process.env.GIT_PERSIST_PUSH === "1") {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd }).toString().trim();
      execSync(`git push -u origin ${branch}`, { cwd });
    }
  } catch {
    // ignore: not a git repo, no changes, push failed, or auth
  }
}
