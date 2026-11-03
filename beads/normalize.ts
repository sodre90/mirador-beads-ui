import type { ActivityEntry, Comment, Detail, FieldChange, Issue, Link, Memory } from "./model.ts";

/** An issue as `bd list --json` gives it; fields bd leaves out when empty are optional. */
export interface RawIssue {
  id: string;
  title: string;
  status: string;
  issue_type: string;
  priority: number;
  parent?: string;
  assignee?: string;
  labels?: string[] | null;
  dependencies?: { issue_id: string; depends_on_id: string; type: string }[] | null;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  close_reason?: string;
  defer_until?: string;
  comment_count?: number;
  description?: string;
  design?: string;
  acceptance_criteria?: string;
  notes?: string;
  created_by?: string;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const orNull = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);

const dependenciesOf = (raw: RawIssue) => raw.dependencies ?? [];

export const issueOf = (raw: RawIssue): Issue => ({
  id: raw.id,
  title: text(raw.title),
  status: text(raw.status) || "open",
  type: text(raw.issue_type) || "task",
  priority: Number.isInteger(raw.priority) ? raw.priority : 2,
  parent: orNull(raw.parent) ?? dependenciesOf(raw).find(({ type }) => type === "parent-child")?.depends_on_id ?? null,
  assignee: orNull(raw.assignee),
  labels: raw.labels ?? [],
  blockedBy: dependenciesOf(raw)
    .filter(({ type }) => type === "blocks")
    .map(({ depends_on_id }) => depends_on_id),
  createdAt: text(raw.created_at),
  updatedAt: text(raw.updated_at),
  closedAt: orNull(raw.closed_at),
  closeReason: orNull(raw.close_reason),
  deferUntil: orNull(raw.defer_until),
  comments: raw.comment_count ?? 0,
});

/** Links shown in the detail: neither parent-child nor blocks, which the issue itself carries, in both directions. */
const LINK_TYPES_SHOWN_ELSEWHERE = new Set(["parent-child", "blocks"]);

export function linksOf(id: string, all: RawIssue[]): Link[] {
  const byId = new Map(all.map((raw) => [raw.id, raw]));
  const own = byId.get(id);
  const linkTo = (otherId: string, type: string, direction: Link["direction"]): Link => {
    const other = byId.get(otherId);
    return { id: otherId, type, title: other ? text(other.title) : "", status: other ? text(other.status) : "open", direction };
  };
  const outgoing = dependenciesOf(own ?? ({} as RawIssue))
    .filter(({ type }) => !LINK_TYPES_SHOWN_ELSEWHERE.has(type))
    .map(({ depends_on_id, type }) => linkTo(depends_on_id, type, "out"));
  const incoming = all.flatMap((raw) =>
    dependenciesOf(raw)
      .filter(({ depends_on_id, type }) => depends_on_id === id && !LINK_TYPES_SHOWN_ELSEWHERE.has(type))
      .map(({ type }) => linkTo(raw.id, type, "in")),
  );
  return [...outgoing, ...incoming];
}

export const commentOf = (raw: Record<string, unknown>): Comment => ({
  id: text(raw.id),
  author: text(raw.author),
  text: text(raw.text),
  at: text(raw.created_at),
});

export const detailOf = (raw: RawIssue, all: RawIssue[], comments: Comment[]): Detail => ({
  id: raw.id,
  description: text(raw.description),
  design: text(raw.design),
  acceptance: text(raw.acceptance_criteria),
  notes: text(raw.notes),
  links: linksOf(raw.id, all),
  comments,
  createdBy: orNull(raw.created_by),
});

/** `bd memories --json` is one object of key to text, with bd's schema_version beside them. */
export const memoriesOf = (raw: Record<string, unknown>): Memory[] =>
  Object.entries(raw)
    .filter(([key, value]) => key !== "schema_version" && typeof value === "string")
    .map(([key, value]) => ({ key, text: value as string }))
    .sort((a, b) => a.key.localeCompare(b.key));

const TRACKED_FIELDS: [string, string][] = [
  ["status", "status"],
  ["priority", "priority"],
  ["issue_type", "type"],
  ["assignee", "assignee"],
  ["title", "title"],
  ["description", "description"],
  ["design", "design"],
  ["acceptance_criteria", "acceptance"],
  ["notes", "notes"],
  ["labels", "labels"],
];

interface JournalRecord {
  seq: number;
  ts: string;
  op: string;
  issue_id: string;
  actor?: string;
  issue?: Record<string, unknown>;
  dep?: { kind?: string; target?: string };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The journal's records as activity, oldest first: each update set against the issue's snapshot before it, so the
 * entry names the fields it changed. An update whose earlier snapshot fell out of the window shows no changes.
 */
export function activityOf(lines: string[]): ActivityEntry[] {
  const before = new Map<string, Record<string, unknown>>();
  return lines.flatMap((line) => {
    let record: JournalRecord;
    try {
      record = JSON.parse(line) as JournalRecord;
    } catch {
      return [];
    }
    if (typeof record.seq !== "number" || !record.issue_id) return [];
    const snapshot = record.issue ?? {};
    const previous = before.get(record.issue_id);
    const changes: FieldChange[] = previous
      ? TRACKED_FIELDS.filter(([raw]) => !same(previous[raw], snapshot[raw])).map(([raw, field]) => ({ field, from: previous[raw] ?? null, to: snapshot[raw] ?? null }))
      : [];
    if (record.issue) before.set(record.issue_id, snapshot);
    return [
      {
        seq: record.seq,
        at: record.ts,
        op: record.op,
        issueId: record.issue_id,
        title: text(snapshot.title),
        actor: text(record.actor),
        changes,
        dep: record.dep?.target ? { target: record.dep.target, kind: text(record.dep.kind) } : null,
      },
    ];
  });
}

/** `bd where`: the .beads folder on its first line, then `prefix: …`. */
export function whereOf(output: string): { beadsDir: string; prefix: string } | null {
  const lines = output.split("\n").map((line) => line.trim());
  const beadsDir = lines[0];
  if (!beadsDir || !/^([A-Za-z]:)?[\\/]/.test(beadsDir)) return null;
  const prefix = lines.find((line) => line.startsWith("prefix:"))?.slice("prefix:".length).trim() ?? "";
  return { beadsDir, prefix };
}
