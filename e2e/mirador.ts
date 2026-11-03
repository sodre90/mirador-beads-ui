import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Mirador's checkout, whose test host and helpers the specs use; by default it sits next to this one. */
export const miradorDir = process.env.MIRADOR_DIR ?? join(import.meta.dirname, "..", "..", "visualized-claude-sessions");
/** The plugin as the specs install it: scripts/e2e.sh builds a copy, so the owner's own Mirador never runs a test's build. */
const pluginDir = process.env.BEADS_PLUGIN_DIR ?? join(import.meta.dirname, "..");

type Helpers = typeof import("../../visualized-claude-sessions/e2e/helpers.ts");
type TestHostModule = typeof import("../../visualized-claude-sessions/e2e/test-host.ts");
export type TestHost = InstanceType<TestHostModule["TestHost"]>;

let loadedHelpers: Helpers | null = null;
export const helpers = () => {
  if (!loadedHelpers) throw new Error("Start the host first.");
  return loadedHelpers;
};

export const ME = "dana";

/**
 * A started Mirador test host with this plugin, a project folder holding a real beads database of a made-up app,
 * and an opencode stand-in that writes each prompt to `promptsFile`. `bd` runs the real bd in that folder.
 */
export async function startHostWithThisPlugin() {
  const { TestHost, writeBunProgram } = (await import(join(miradorDir, "e2e", "test-host.ts"))) as TestHostModule;
  loadedHelpers = (await import(join(miradorDir, "e2e", "helpers.ts"))) as Helpers;
  const host = new TestHost({ fakePrograms: true, environment: { BEADS_ACTOR: ME } });
  const promptsFile = join(host.root, "prompts");
  writeBunProgram(host.fakeProgramsDir, "opencode", join(miradorDir, "e2e", "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  mkdirSync(join(host.dataDir, "plugins"), { recursive: true });
  symlinkSync(pluginDir, join(host.dataDir, "plugins", "beads"));
  mkdirSync(host.projectDir, { recursive: true });
  const bd = (...args: string[]) => execFileSync("bd", args, { cwd: host.projectDir, env: { ...process.env, BEADS_ACTOR: ME }, encoding: "utf8" });
  seedKite(host.projectDir, bd);
  await host.start();
  return { host, promptsFile, bd };
}

/** Kite, a note-taking app nobody makes: an epic with its work, a loose bug, a comment and two memories. */
function seedKite(folder: string, bd: (...args: string[]) => string) {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: folder });
  git("init", "-q", "-b", "main");
  git("config", "user.name", ME);
  git("config", "user.email", "dana@example.invalid");
  bd("init", "--prefix", "kt", "--quiet", "--non-interactive", "--skip-agents", "--skip-hooks");
  bd("config", "set", "events-journal", "true");
  bd("create", "--id", "kt-off", "--title", "Offline mode: notes work without a connection", "--type", "epic", "--priority", "1", "--description", "Notes open, change and sync later.");
  bd("create", "--parent", "kt-off", "--title", "Keep a local copy of every note", "--type", "task", "--priority", "1");
  bd("create", "--parent", "kt-off", "--title", "Queue edits made offline and replay them", "--type", "feature", "--priority", "1", "--labels", "sync", "--description", "Every edit goes into a queue first.", "--design", "An append-only log in IndexedDB, keyed by note.");
  bd("create", "--parent", "kt-off", "--title", "Resolve conflicts when two devices edit one note", "--type", "feature", "--priority", "2", "--labels", "sync");
  bd("create", "--parent", "kt-off", "--title", "Show a banner while offline", "--type", "task", "--priority", "3", "--labels", "ui");
  bd("create", "--id", "kt-7", "--title", "Notes vanish after renaming a folder", "--type", "bug", "--priority", "0");
  bd("close", "kt-off.1", "--reason", "Local store landed");
  bd("update", "kt-off.2", "--claim");
  bd("dep", "add", "kt-off.3", "kt-off.2");
  bd("comments", "add", "kt-off.2", "Replay order matters for renames.");
  bd("remember", "--key", "release-steps", "Bump the version, tag it, then push the tag.");
  bd("remember", "--key", "sync-replay-order", "The offline queue replays in the order edits were made.");
}
