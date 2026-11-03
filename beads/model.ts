export const STATUSES = ["open", "in_progress", "blocked", "deferred", "closed"] as const;
export type Status = (typeof STATUSES)[number] | (string & {});

export const TYPES = ["task", "bug", "feature", "chore", "epic", "decision", "spike"] as const;
export type IssueType = (typeof TYPES)[number] | (string & {});

export const PRIORITIES = [0, 1, 2, 3, 4] as const;

/** An issue as the board, the trees and the list need it: everything but its long texts, which come with its detail. */
export interface Issue {
  id: string;
  title: string;
  status: Status;
  type: IssueType;
  priority: number;
  parent: string | null;
  assignee: string | null;
  labels: string[];
  /** The issues this one waits for: its `blocks` dependencies, open or not. */
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  deferUntil: string | null;
  comments: number;
}

export interface Comment {
  id: string;
  author: string;
  text: string;
  at: string;
}

/** A link other than parent and blocks, which only the detail shows. */
export interface Link {
  id: string;
  type: string;
  title: string;
  status: Status;
  /** Out: this issue points at it; in: it points at this one. */
  direction: "out" | "in";
}

export interface Detail {
  id: string;
  description: string;
  design: string;
  acceptance: string;
  notes: string;
  links: Link[];
  comments: Comment[];
  createdBy: string | null;
}

export interface BdProblem {
  code: "not-installed" | "no-database" | "failed";
  message: string;
}

export interface DetailResult {
  detail: Detail | null;
  problem: BdProblem | null;
  fetchedAt: number;
}

export interface Memory {
  key: string;
  text: string;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

/** One write from beads' events journal, with what it changed next to the snapshot before it. */
export interface ActivityEntry {
  seq: number;
  at: string;
  op: string;
  issueId: string;
  title: string;
  actor: string;
  changes: FieldChange[];
  /** For dependency changes: the other issue and the kind of link. */
  dep: { target: string; kind: string } | null;
}

export interface Connection {
  /** The .beads folder `bd where` named, absolute. */
  beadsDir: string;
  prefix: string;
}

export interface Candidate extends Connection {
  issues: number;
}

export type View = "now" | "epics" | "issues" | "memories" | "activity";
export const VIEWS: View[] = ["now", "epics", "issues", "memories", "activity"];

export type GroupBy = "epic" | "status" | "type" | "priority" | "none";
export type SortBy = "priority" | "updated" | "created" | "id";

export interface IssueFilter {
  statuses: Status[];
  types: IssueType[];
  priorities: number[];
  assignee: "anyone" | "me" | "unassigned" | "me-or-unassigned" | (string & {});
  labels: string[];
  epic: string | null;
}

export interface Prefs {
  view: View;
  filter: IssueFilter;
  nowFilter: Pick<IssueFilter, "assignee" | "types" | "priorities" | "labels" | "epic">;
  group: GroupBy;
  sort: SortBy;
  tree: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  view: "now",
  filter: { statuses: ["open", "in_progress", "blocked", "deferred"], types: [], priorities: [], assignee: "anyone", labels: [], epic: null },
  nowFilter: { assignee: "anyone", types: [], priorities: [], labels: [], epic: null },
  group: "epic",
  sort: "priority",
  tree: true,
};

export interface TabState {
  connection: Connection | null;
  candidate: Candidate | null;
  problem: BdProblem | null;
  /** Null until the first read lands. */
  issues: Issue[] | null;
  memories: Memory[] | null;
  details: Record<string, DetailResult>;
  activity: ActivityEntry[] | null;
  /** Whether beads keeps its events journal here; without it, activity comes from the issues' times. */
  journal: boolean;
  /** The issues the last read found changed or new since the one before, to highlight. */
  changed: string[];
  loadedAt: number | null;
  loading: boolean;
  me: string | null;
  prefs: Prefs;
}

/** How to put a small edit back, which the toast's Undo sends; the host checks the field still holds `to` first. */
export type Undo =
  | { kind: "status"; id: string; from: Status; to: Status }
  | { kind: "claim"; id: string; from: { status: Status; assignee: string | null } }
  | { kind: "priority"; id: string; from: number; to: number }
  | { kind: "type"; id: string; from: IssueType; to: IssueType }
  | { kind: "assignee"; id: string; from: string | null; to: string | null }
  | { kind: "labels"; id: string; added: string[]; removed: string[] }
  | { kind: "notes"; id: string; from: string; to: string }
  | { kind: "memory"; key: string; text: string };

export type TextField = "title" | "description" | "design" | "acceptance" | "notes";

export type TabAction =
  | { kind: "connect" }
  | { kind: "disconnect" }
  | { kind: "poll" }
  | { kind: "refresh" }
  | { kind: "open"; id: string }
  | { kind: "search"; text: string }
  | { kind: "activity" }
  | { kind: "prefs"; prefs: Prefs }
  | { kind: "claim"; id: string }
  | { kind: "unclaim"; id: string }
  | { kind: "status"; id: string; status: Status }
  | { kind: "priority"; id: string; priority: number }
  | { kind: "type"; id: string; type: IssueType }
  | { kind: "assignee"; id: string; assignee: string | null }
  | { kind: "labels"; id: string; add: string[]; remove: string[] }
  | { kind: "append-note"; id: string; text: string }
  | { kind: "edit"; id: string; field: TextField; value: string }
  | { kind: "comment"; id: string; text: string }
  | { kind: "close"; id: string; reason: string }
  | { kind: "reopen"; id: string }
  | { kind: "defer"; id: string; until: string }
  | { kind: "create"; title: string; type: IssueType; priority: number; parent: string | null; description: string; labels: string[] }
  | { kind: "link"; id: string; on: string; type: string }
  | { kind: "unlink"; id: string; on: string }
  | { kind: "parent"; id: string; parent: string | null }
  | { kind: "remember"; key: string; text: string }
  | { kind: "forget"; key: string }
  | { kind: "undo"; undo: Undo };

export type WriteAction = Exclude<TabAction, { kind: "connect" | "disconnect" | "poll" | "refresh" | "open" | "search" | "activity" | "prefs" | "undo" }>;

export interface WriteReply {
  done: true;
  undo: Undo | null;
  /** A created issue's id. */
  id?: string;
}

export interface SearchReply {
  ids: string[];
  /** A line around the first match in each issue's long texts, by id. */
  snippets: Record<string, string>;
}
