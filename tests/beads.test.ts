import { describe, expect, test } from "bun:test";
import { problemOf, shellText, undoArgs, writeArgs } from "../beads/bd.ts";
import { boardOf, canClose, effectiveStatus, Graph, groupsOf, memoryGroups, memoryTitle, nextReady, openEpics, passes, progressOf, rowsOf, titleMatches } from "../beads/derive.ts";
import { issueOf, memoriesOf, whereOf } from "../beads/normalize.ts";
import { ProgramMissing } from "../beads/run.ts";
import { ISSUES, ME, MEMORIES, NOW } from "./fixtures/beads.ts";

const graph = new Graph(ISSUES.map(issueOf));
const issue = (id: string) => graph.byId.get(id)!;

describe("bd's answers", () => {
  test("an issue takes its parent from the field or its parent-child link, and its blockers from blocks links", () => {
    expect(issue("kt-off.3")).toMatchObject({ parent: "kt-off", blockedBy: ["kt-off.2"], labels: ["sync"], type: "feature" });
    expect(issue("kt-7")).toMatchObject({ parent: null, assignee: null, blockedBy: [] });
  });

  test("memories leave bd's schema_version out", () => {
    expect(memoriesOf({ ...MEMORIES, schema_version: 1 }).map(({ key }) => key)).not.toContain("schema_version");
  });

  test("bd where gives the folder and the prefix", () => {
    expect(whereOf("/work/kite/.beads\n  prefix: kt\n  database: /work/kite/.beads/embeddeddolt\n")).toEqual({ beadsDir: "/work/kite/.beads", prefix: "kt" });
    expect(whereOf("C:\\work\\kite\\.beads\n  prefix: kt\n")?.prefix).toBe("kt");
    expect(whereOf("no beads database\n")).toBeNull();
  });

  test("a missing bd and a failed command read as problems", () => {
    expect(problemOf(new ProgramMissing("bd")).code).toBe("not-installed");
    expect(problemOf({ code: 1, stdout: "", stderr: "Error: no beads database found\n" })).toEqual({ code: "no-database", message: "no beads database found" });
  });
});

describe("the board and the epics", () => {
  test("ready means open with nothing open blocking it; a blocker that's done doesn't count", () => {
    expect(graph.isReady(issue("kt-7"))).toBe(true);
    expect(graph.isReady(issue("kt-off.3"))).toBe(false);
    expect(graph.isBlocked(issue("kt-off.3"))).toBe(true);
    expect(effectiveStatus(graph, issue("kt-off.3"))).toBe("blocked");
    const unblocked = new Graph(ISSUES.map(issueOf).map((each) => (each.id === "kt-off.2" ? { ...each, status: "closed" } : each)));
    expect(unblocked.isReady(unblocked.byId.get("kt-off.3")!)).toBe(true);
  });

  test("the board sorts each column by priority, and Done holds the last week", () => {
    const board = boardOf(graph, () => true, NOW);
    expect(board.inProgress.map(({ id }) => id)).toEqual(["kt-off.2"]);
    expect(board.ready.map(({ id }) => id)).toEqual(["kt-7", "kt-9", "kt-off.4"]);
    expect(board.blocked.map(({ id }) => id)).toEqual(["kt-off.3"]);
    expect(board.done.map(({ id }) => id)).toEqual(["kt-onb.1", "kt-off.1"]);
  });

  test("an epic's progress counts its work by state, and its next ready piece", () => {
    expect(progressOf(graph, "kt-off")).toEqual({ total: 4, done: 1, inProgress: 1, blocked: 1, open: 1, deferred: 0 });
    expect(nextReady(graph, "kt-off")?.id).toBe("kt-off.4");
  });

  test("an epic whose work is all done comes first, to be closed", () => {
    expect(canClose(progressOf(graph, "kt-onb"))).toBe(true);
    expect(openEpics(graph).map(({ epic }) => epic.id)).toEqual(["kt-onb", "kt-off"]);
  });
});

describe("filters, groups and trees", () => {
  test("chips filter by assignee, label and epic", () => {
    const shown = (filter: Parameters<typeof passes>[2]) => graph.issues.filter((each) => passes(graph, each, filter, ME)).map(({ id }) => id);
    expect(shown({ assignee: "me" })).toEqual(["kt-off.2"]);
    expect(shown({ labels: ["ui"] })).toEqual(["kt-off.4", "kt-8"]);
    expect(shown({ epic: "kt-onb" })).toEqual(["kt-onb", "kt-onb.1", "kt-onb.2"]);
    expect(shown({ statuses: ["blocked"] })).toEqual(["kt-off.3"]);
  });

  test("the instant search matches every word in the id or title", () => {
    expect(titleMatches(issue("kt-7"), "accents SEARCH")).toBe(true);
    expect(titleMatches(issue("kt-7"), "kt-7")).toBe(true);
    expect(titleMatches(issue("kt-7"), "pdf")).toBe(false);
  });

  test("grouping by epic puts loose issues last and leaves the epic out of its own rows", () => {
    const groups = groupsOf(graph, graph.issues.filter((each) => each.status !== "closed"), "epic", "priority", true);
    expect(groups.map(({ key }) => key)).toEqual(["kt-off", "kt-onb", ""]);
    expect(groups[0]!.rows.map(({ issue: { id } }) => id)).toEqual(["kt-off.2", "kt-off.3", "kt-off.4"]);
    expect(groups[2]!.title).toBe("No epic");
  });

  test("a tree puts children right under their parent", () => {
    const rows = rowsOf([issue("kt-off.3"), issue("kt-off"), issue("kt-7")], "priority", true);
    expect(rows.map(({ issue: { id }, depth }) => `${id}:${depth}`)).toEqual(["kt-7:0", "kt-off:0", "kt-off.3:1"]);
  });
});

describe("memories", () => {
  test("group by the first word of their key, and read as titles", () => {
    expect(memoryGroups(memoriesOf(MEMORIES))).toEqual([
      { name: "sync", count: 2 },
      { name: "release", count: 1 },
    ]);
    expect(memoryTitle("sync-replay-order")).toBe("Sync replay order");
  });
});

describe("bd commands", () => {
  test("each write is one bd command, shown as it runs", () => {
    expect(writeArgs({ kind: "claim", id: "kt-7" })).toEqual(["update", "kt-7", "--claim"]);
    expect(writeArgs({ kind: "labels", id: "kt-7", add: ["ui"], remove: ["search"] })).toEqual(["update", "kt-7", "--add-label", "ui", "--remove-label", "search"]);
    expect(writeArgs({ kind: "assignee", id: "kt-7", assignee: null })).toEqual(["update", "kt-7", "--assignee", ""]);
    expect(writeArgs({ kind: "defer", id: "kt-7", until: "next monday" })).toEqual(["defer", "kt-7", "--until=next monday"]);
    expect(writeArgs({ kind: "create", title: " Sync settings ", type: "task", priority: 1, parent: "kt-off", description: "", labels: ["sync"] })).toEqual([
      "create",
      "--title",
      "Sync settings",
      "--type",
      "task",
      "--priority",
      "1",
      "--parent",
      "kt-off",
      "--labels",
      "sync",
      "--json",
    ]);
    expect(shellText(writeArgs({ kind: "comment", id: "kt-7", text: "It's fixed" }))).toBe("bd comment kt-7 'It'\\''s fixed'");
  });

  test("Undo guards a status and an assignee with what the edit set", () => {
    expect(undoArgs({ kind: "status", id: "kt-7", from: "open", to: "blocked" })).toEqual(["update", "kt-7", "--status", "open", "--if-status", "blocked"]);
    expect(undoArgs({ kind: "assignee", id: "kt-7", from: null, to: "lee" })).toEqual(["update", "kt-7", "--assignee", "", "--if-assignee", "lee"]);
  });
});
