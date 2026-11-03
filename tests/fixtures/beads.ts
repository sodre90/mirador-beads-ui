import type { RawIssue } from "../../beads/normalize.ts";

/** A made-up project, Kite, a note-taking app: two epics, their work, and some loose issues. Nothing here is real. */
export const NOW = Date.parse("2026-06-10T12:00:00Z");
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3600_000).toISOString().replace(".000", "");
const child = (id: string, parent: string) => ({ issue_id: id, depends_on_id: parent, type: "parent-child" });
const blocks = (id: string, on: string) => ({ issue_id: id, depends_on_id: on, type: "blocks" });

export const ME = "dana";

export const ISSUES: RawIssue[] = [
  {
    id: "kt-off",
    title: "Offline mode: notes work without a connection",
    status: "open",
    issue_type: "epic",
    priority: 1,
    created_at: at(400),
    updated_at: at(30),
    description: "Notes open, change and sync later when the phone has no connection.",
  },
  {
    id: "kt-off.1",
    title: "Keep a local copy of every note",
    status: "closed",
    issue_type: "task",
    priority: 1,
    parent: "kt-off",
    dependencies: [child("kt-off.1", "kt-off")],
    created_at: at(390),
    updated_at: at(100),
    closed_at: at(100),
    close_reason: "Local store landed",
  },
  {
    id: "kt-off.2",
    title: "Queue edits made offline and replay them",
    status: "in_progress",
    issue_type: "feature",
    priority: 1,
    parent: "kt-off",
    assignee: ME,
    labels: ["sync"],
    dependencies: [child("kt-off.2", "kt-off")],
    created_at: at(380),
    updated_at: at(2),
    comment_count: 1,
    description: "Every edit goes into a queue first. The queue replays in order once the connection is back.",
    design: "An append-only log in IndexedDB, keyed by note.",
    acceptance_criteria: "Edits made in airplane mode show on another device within a minute of reconnecting.",
    notes: "Replay order matters for renames.",
  },
  {
    id: "kt-off.3",
    title: "Resolve conflicts when two devices edit one note",
    status: "open",
    issue_type: "feature",
    priority: 2,
    parent: "kt-off",
    labels: ["sync"],
    dependencies: [child("kt-off.3", "kt-off"), blocks("kt-off.3", "kt-off.2")],
    created_at: at(370),
    updated_at: at(50),
    description: "Show both versions side by side and let the user pick, or keep both.",
  },
  {
    id: "kt-off.4",
    title: "Show a banner while offline",
    status: "open",
    issue_type: "task",
    priority: 3,
    parent: "kt-off",
    labels: ["ui"],
    dependencies: [child("kt-off.4", "kt-off")],
    created_at: at(360),
    updated_at: at(60),
  },
  {
    id: "kt-onb",
    title: "Onboarding for new users",
    status: "open",
    issue_type: "epic",
    priority: 2,
    created_at: at(300),
    updated_at: at(200),
  },
  {
    id: "kt-onb.1",
    title: "Welcome note with three tips",
    status: "closed",
    issue_type: "task",
    priority: 2,
    parent: "kt-onb",
    dependencies: [child("kt-onb.1", "kt-onb")],
    created_at: at(290),
    updated_at: at(20),
    closed_at: at(20),
  },
  {
    id: "kt-onb.2",
    title: "Import notes from a folder of Markdown files",
    status: "closed",
    issue_type: "feature",
    priority: 2,
    parent: "kt-onb",
    dependencies: [child("kt-onb.2", "kt-onb")],
    created_at: at(280),
    updated_at: at(250),
    closed_at: at(250),
  },
  {
    id: "kt-7",
    title: "Search misses words with accents",
    status: "open",
    issue_type: "bug",
    priority: 0,
    labels: ["search"],
    created_at: at(10),
    updated_at: at(5),
    description: "Searching for cafe doesn't find café. Normalize both sides before matching.",
  },
  {
    id: "kt-8",
    title: "Dark theme for the editor",
    status: "deferred",
    issue_type: "feature",
    priority: 3,
    labels: ["ui"],
    created_at: at(500),
    updated_at: at(480),
    defer_until: "2026-09-01",
  },
  {
    id: "kt-9",
    title: "Export a note as PDF",
    status: "open",
    issue_type: "feature",
    priority: 2,
    assignee: "lee",
    dependencies: [{ issue_id: "kt-9", depends_on_id: "kt-7", type: "related" }],
    created_at: at(40),
    updated_at: at(40),
  },
];

export const COMMENTS: Record<string, { id: string; issue_id: string; author: string; text: string; created_at: string }[]> = {
  "kt-off.2": [{ id: "c1", issue_id: "kt-off.2", author: "lee", text: "Renames before edits, or the replay loses them.", created_at: at(3) }],
};

export const MEMORIES: Record<string, string> = {
  "sync-replay-order": "Replay queued edits in the order they were made; a rename replayed late orphans the edits after it.",
  "sync-indexeddb-quota": "Safari caps IndexedDB at about 1 GB per origin; the local store warns at 800 MB.",
  "release-steps": "Bump the version, tag it, and let the release workflow build the stores' packages.",
};

export const JOURNAL: object[] = [
  { seq: 41, ts: at(6), op: "update", issue_id: "kt-off.2", actor: ME, issue: { id: "kt-off.2", title: "Queue edits made offline and replay them", status: "open", priority: 1, issue_type: "feature" } },
  { seq: 42, ts: at(2), op: "update", issue_id: "kt-off.2", actor: ME, issue: { id: "kt-off.2", title: "Queue edits made offline and replay them", status: "in_progress", priority: 1, issue_type: "feature", assignee: ME } },
  { seq: 43, ts: at(1), op: "dep_add", issue_id: "kt-off.3", actor: ME, issue: { id: "kt-off.3", title: "Resolve conflicts when two devices edit one note", status: "open" }, dep: { kind: "blocks", target: "kt-off.2" } },
];
