import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceTabContext } from "../mirador/api.ts";
import type { SearchReply, TabState, WriteReply } from "../beads/model.ts";
import { BeadsTab, MIN_RELOAD_GAP_MS, TIMED_RELOAD_MS } from "../beads/tab.ts";
import { FakeBeads } from "./fake-bd.ts";
import { ME } from "./fixtures/beads.ts";

function setUp({ manifest = false } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "mirador-beads-"));
  const beadsDir = join(folder, ".beads");
  mkdirSync(beadsDir);
  const manifestPath = join(beadsDir, "embeddeddolt", "kt", ".dolt", "noms", "manifest");
  const writeManifest = (text: string) => writeFileSync(manifestPath, text);
  if (manifest) {
    mkdirSync(join(beadsDir, "embeddeddolt", "kt", ".dolt", "noms"), { recursive: true });
    writeManifest("root-1");
  }
  const beads = new FakeBeads(beadsDir);
  const stored = new Map<string, unknown>();
  let clock = 1_000_000;
  const context: WorkspaceTabContext = {
    workspace: { id: "w1", name: "kite", folder },
    storage: { get: (key) => stored.get(key), set: (key, value) => void (value === undefined ? stored.delete(key) : stored.set(key, value)) },
    sharedStorage: { get: () => undefined, set: () => {} },
    changed: () => {},
  };
  const tab = new BeadsTab(beads.runner, () => clock);
  const state = () => tab.state(context) as Promise<TabState>;
  const act = (action: object) => tab.action(action, context);
  const pass = (ms: number) => void (clock += ms);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
  return { beads, tab, context, state, act, pass, settle, writeManifest, folder, beadsDir };
}

async function connected(options?: { manifest?: boolean }) {
  const setup = setUp(options);
  await setup.act({ kind: "connect" });
  await setup.settle();
  return setup;
}

describe("connecting", () => {
  test("the tab shows in a folder with .beads, and offers the database bd finds there", async () => {
    const { tab, context, state } = setUp();
    expect(tab.shows(context)).toBe(true);
    const before = await state();
    expect(before.connection).toBeNull();
    expect(before.candidate).toMatchObject({ prefix: "kt", issues: 11 });
  });

  test("connecting reads the issues, the memories and who bd writes as", async () => {
    const { state, beadsDir } = await connected();
    const after = await state();
    expect(after.connection).toEqual({ beadsDir, prefix: "kt" });
    expect(after.issues).toHaveLength(11);
    expect(after.memories?.map(({ key }) => key)).toEqual(["release-steps", "sync-indexeddb-quota", "sync-replay-order"]);
    expect(after.me).toBe(ME);
  });

  test("without bd, the tab says how to get it", async () => {
    const { beads, state } = setUp();
    beads.installed = false;
    const shown = await state();
    expect(shown.candidate).toBeNull();
    expect(shown.problem?.code).toBe("not-installed");
  });
});

describe("staying fresh", () => {
  test("polls read again only when the Dolt manifest changed", async () => {
    const { beads, act, pass, writeManifest } = await connected({ manifest: true });
    const lists = beads.reads("list");
    pass(MIN_RELOAD_GAP_MS);
    await act({ kind: "poll" });
    expect(beads.reads("list")).toBe(lists);
    writeManifest("root-2");
    await act({ kind: "poll" });
    expect(beads.reads("list")).toBe(lists + 1);
  });

  test("however many views poll, reads stay apart", async () => {
    const { beads, act, writeManifest } = await connected({ manifest: true });
    const lists = beads.reads("list");
    writeManifest("root-2");
    await Promise.all([act({ kind: "poll" }), act({ kind: "poll" }), act({ kind: "poll" })]);
    expect(beads.reads("list")).toBe(lists);
  });

  test("without a manifest, the tab reads again on a timer", async () => {
    const { beads, act, pass } = await connected();
    const lists = beads.reads("list");
    pass(TIMED_RELOAD_MS - 1);
    await act({ kind: "poll" });
    expect(beads.reads("list")).toBe(lists);
    pass(1);
    await act({ kind: "poll" });
    expect(beads.reads("list")).toBe(lists + 1);
  });

  test("the issues an agent changed since the last read are marked", async () => {
    const { beads, act, state, settle } = await connected();
    beads.answer(["update", "kt-7", "--priority", "1"]);
    await act({ kind: "refresh" });
    await settle();
    expect((await state()).changed).toEqual(["kt-7"]);
  });
});

describe("details and search", () => {
  test("an opened issue has its long texts, its comments and its links both ways", async () => {
    const { act, state } = await connected();
    await act({ kind: "open", id: "kt-off.2" });
    await act({ kind: "open", id: "kt-7" });
    const { details } = await state();
    expect(details["kt-off.2"]?.detail).toMatchObject({ design: "An append-only log in IndexedDB, keyed by note.", notes: "Replay order matters for renames." });
    expect(details["kt-off.2"]?.detail?.comments.map(({ author }) => author)).toEqual(["lee"]);
    expect(details["kt-7"]?.detail?.links).toEqual([{ id: "kt-9", type: "related", title: "Export a note as PDF", status: "open", direction: "in" }]);
  });

  test("a comment shows in the open issue, though bd leaves its updated time as it was", async () => {
    const { act, state, settle } = await connected();
    await act({ kind: "open", id: "kt-off.2" });
    await act({ kind: "comment", id: "kt-off.2", text: "Renames go first." });
    await settle();
    const { details } = await state();
    expect(details["kt-off.2"]?.detail?.comments.map(({ text }) => text)).toContain("Renames go first.");
  });

  test("an issue without comments costs no bd call to open", async () => {
    const { beads, act } = await connected();
    await act({ kind: "open", id: "kt-7" });
    expect(beads.reads("comments")).toBe(0);
  });

  test("search finds words in the long texts, with a snippet", async () => {
    const { act } = await connected();
    const found = (await act({ kind: "search", text: "airplane" })) as SearchReply;
    expect(found.ids).toEqual(["kt-off.2"]);
    expect(found.snippets["kt-off.2"]).toContain("airplane mode");
  });
});

describe("activity", () => {
  test("comes from the journal, from the oldest record bd keeps, newest first, with the fields each write changed", async () => {
    const { act, state } = await connected();
    await act({ kind: "activity" });
    const { activity, journal } = await state();
    expect(journal).toBe(true);
    expect(activity?.map(({ seq }) => seq)).toEqual([43, 42, 41]);
    expect(activity?.[1]?.changes).toEqual([
      { field: "status", from: "open", to: "in_progress" },
      { field: "assignee", from: null, to: ME },
    ]);
    expect(activity?.[0]?.dep).toEqual({ target: "kt-off.2", kind: "blocks" });
  });

  test("reads on from where it stopped", async () => {
    const { beads, act, state } = await connected();
    await act({ kind: "activity" });
    beads.journal.push({ seq: 44, ts: "2026-06-10T12:00:00Z", op: "close", issue_id: "kt-7", issue: { id: "kt-7", title: "Search misses words with accents", status: "closed" } } as never);
    await act({ kind: "activity" });
    expect(beads.calls.filter(([command]) => command === "events").at(-1)).toEqual(["events", "tail", "--since", "43"]);
    expect((await state()).activity?.[0]?.seq).toBe(44);
  });

  test("without the journal, the activity is empty and says so", async () => {
    const { beads, act, state } = await connected();
    beads.journalOn = false;
    await act({ kind: "activity" });
    expect((await state()).journal).toBe(false);
  });
});

describe("small edits and Undo", () => {
  test("a claim puts the issue in progress for me, and Undo releases it", async () => {
    const { beads, act, settle } = await connected();
    const reply = (await act({ kind: "claim", id: "kt-7" })) as WriteReply;
    await settle();
    expect(beads.issues.find(({ id }) => id === "kt-7")).toMatchObject({ status: "in_progress", assignee: ME });
    await act({ kind: "undo", undo: reply.undo });
    expect(beads.issues.find(({ id }) => id === "kt-7")).toMatchObject({ status: "open", assignee: undefined });
  });

  test("Undo of a status change leaves it when someone changed it since", async () => {
    const { beads, act, settle } = await connected();
    const reply = (await act({ kind: "status", id: "kt-9", status: "blocked" })) as WriteReply;
    await settle();
    beads.answer(["update", "kt-9", "--status", "in_progress"]);
    expect(act({ kind: "undo", undo: reply.undo })).rejects.toThrow("It changed since");
    await settle();
    expect(beads.issues.find(({ id }) => id === "kt-9")?.status).toBe("in_progress");
  });

  test("Undo of a note takes back only that note, and refuses once another follows it", async () => {
    const { beads, act, settle } = await connected();
    const first = (await act({ kind: "append-note", id: "kt-off.2", text: "Tried on Safari." })) as WriteReply;
    await settle();
    await act({ kind: "undo", undo: first.undo });
    expect(beads.issues.find(({ id }) => id === "kt-off.2")?.notes).toBe("Replay order matters for renames.");
    const second = (await act({ kind: "append-note", id: "kt-off.2", text: "Mine." })) as WriteReply;
    await settle();
    beads.answer(["update", "kt-off.2", "--append-notes", "An agent's."]);
    expect(act({ kind: "undo", undo: second.undo })).rejects.toThrow("It changed since");
  });

  test("labels come back as they were", async () => {
    const { beads, act, settle } = await connected();
    const reply = (await act({ kind: "labels", id: "kt-off.3", add: ["urgent"], remove: ["sync"] })) as WriteReply;
    await settle();
    expect(beads.issues.find(({ id }) => id === "kt-off.3")?.labels).toEqual(["urgent"]);
    await act({ kind: "undo", undo: reply.undo });
    expect(beads.issues.find(({ id }) => id === "kt-off.3")?.labels).toEqual(["sync"]);
  });

  test("a forgotten memory can be remembered again", async () => {
    const { beads, act, settle } = await connected();
    const reply = (await act({ kind: "forget", key: "release-steps" })) as WriteReply;
    await settle();
    expect(beads.memories["release-steps"]).toBeUndefined();
    await act({ kind: "undo", undo: reply.undo });
    expect(beads.memories["release-steps"]).toContain("Bump the version");
  });

  test("a created issue's id comes back, under its parent", async () => {
    const { act } = await connected();
    const reply = (await act({ kind: "create", title: "Sync settings too", type: "task", priority: 2, parent: "kt-off", description: "", labels: [] })) as WriteReply;
    expect(reply.id).toBe("kt-off.5");
  });

  test("bd's refusal reaches the user in its own words", async () => {
    const { act } = await connected();
    expect(act({ kind: "close", id: "kt-nope", reason: "" })).rejects.toThrow("issue kt-nope not found");
  });
});
