import type { GroupBy, Issue, IssueFilter, Memory, SortBy } from "./model.ts";

const DAY_MS = 24 * 60 * 60_000;
export const DONE_DAYS = 7;

export const isClosed = (issue: Pick<Issue, "status">) => issue.status === "closed";

/** The issues of a database with the indexes the views keep asking for. */
export class Graph {
  readonly byId: Map<string, Issue>;
  readonly children: Map<string, Issue[]>;
  /** For each issue, the issues whose blockedBy names it. */
  readonly blocking: Map<string, Issue[]>;

  constructor(readonly issues: Issue[]) {
    this.byId = new Map(issues.map((issue) => [issue.id, issue]));
    this.children = new Map();
    this.blocking = new Map();
    issues.forEach((issue) => {
      if (issue.parent) this.children.set(issue.parent, [...(this.children.get(issue.parent) ?? []), issue]);
      issue.blockedBy.forEach((id) => this.blocking.set(id, [...(this.blocking.get(id) ?? []), issue]));
    });
  }

  /** What still holds the issue back: its blockers that aren't closed. */
  openBlockers(issue: Issue): Issue[] {
    return issue.blockedBy.flatMap((id) => {
      const blocker = this.byId.get(id);
      return blocker && !isClosed(blocker) ? [blocker] : [];
    });
  }

  isBlocked(issue: Issue) {
    return issue.status === "blocked" || (!isClosed(issue) && issue.status !== "deferred" && this.openBlockers(issue).length > 0);
  }

  /** Open, not deferred, and nothing open blocks it, as `bd ready` has it. Epics are containers, so they're never ready work. */
  isReady(issue: Issue) {
    return issue.status === "open" && issue.type !== "epic" && this.openBlockers(issue).length === 0;
  }

  descendants(id: string): Issue[] {
    return (this.children.get(id) ?? []).flatMap((child) => [child, ...this.descendants(child.id)]);
  }

  /** The nearest epic above the issue, or null. */
  epicOf(issue: Issue): Issue | null {
    const seen = new Set<string>();
    let parent = issue.parent ? this.byId.get(issue.parent) : undefined;
    while (parent && !seen.has(parent.id)) {
      if (parent.type === "epic") return parent;
      seen.add(parent.id);
      parent = parent.parent ? this.byId.get(parent.parent) : undefined;
    }
    return null;
  }

  /** The chain of parents from the top down, for a breadcrumb. */
  ancestors(issue: Issue): Issue[] {
    const chain: Issue[] = [];
    const seen = new Set<string>([issue.id]);
    let parent = issue.parent ? this.byId.get(issue.parent) : undefined;
    while (parent && !seen.has(parent.id)) {
      chain.unshift(parent);
      seen.add(parent.id);
      parent = parent.parent ? this.byId.get(parent.parent) : undefined;
    }
    return chain;
  }
}

export interface Progress {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  open: number;
  deferred: number;
}

export function progressOf(graph: Graph, epicId: string): Progress {
  const work = graph.descendants(epicId);
  const count = (test: (issue: Issue) => boolean) => work.filter(test).length;
  const done = count(isClosed);
  const inProgress = count((issue) => issue.status === "in_progress");
  const blocked = count((issue) => !isClosed(issue) && issue.status !== "in_progress" && graph.isBlocked(issue));
  const deferred = count((issue) => issue.status === "deferred");
  return { total: work.length, done, inProgress, blocked, deferred, open: work.length - done - inProgress - blocked - deferred };
}

export const byPriorityThenUpdated = (a: Issue, b: Issue) => a.priority - b.priority || b.updatedAt.localeCompare(a.updatedAt);

export function nextReady(graph: Graph, epicId: string): Issue | null {
  return graph.descendants(epicId).filter((issue) => graph.isReady(issue)).sort(byPriorityThenUpdated)[0] ?? null;
}

/** Open epics first by priority, with those whose work is all done ahead, as they only need closing. */
export function openEpics(graph: Graph): { epic: Issue; progress: Progress; next: Issue | null }[] {
  return graph.issues
    .filter((issue) => issue.type === "epic" && !isClosed(issue))
    .map((epic) => ({ epic, progress: progressOf(graph, epic.id), next: nextReady(graph, epic.id) }))
    .sort((a, b) => Number(canClose(b.progress)) - Number(canClose(a.progress)) || byPriorityThenUpdated(a.epic, b.epic));
}

export const canClose = (progress: Progress) => progress.total > 0 && progress.done === progress.total;

export interface Board {
  inProgress: Issue[];
  ready: Issue[];
  blocked: Issue[];
  done: Issue[];
}

export function boardOf(graph: Graph, shown: (issue: Issue) => boolean, now = Date.now()): Board {
  const issues = graph.issues.filter(shown);
  const since = new Date(now - DONE_DAYS * DAY_MS).toISOString();
  return {
    inProgress: issues.filter((issue) => issue.status === "in_progress").sort(byPriorityThenUpdated),
    ready: issues.filter((issue) => graph.isReady(issue)).sort(byPriorityThenUpdated),
    blocked: issues.filter((issue) => issue.status !== "in_progress" && issue.type !== "epic" && graph.isBlocked(issue)).sort(byPriorityThenUpdated),
    done: issues.filter((issue) => isClosed(issue) && (issue.closedAt ?? issue.updatedAt) >= since).sort((a, b) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt)),
  };
}

/** The status the views show: an open issue that waits for another reads as blocked. */
export const effectiveStatus = (graph: Graph, issue: Issue) => (issue.status === "open" && graph.isBlocked(issue) ? "blocked" : issue.status);

export function assigneeMatches(issue: Issue, assignee: IssueFilter["assignee"], me: string | null) {
  switch (assignee) {
    case "anyone":
      return true;
    case "me":
      return issue.assignee !== null && issue.assignee === me;
    case "unassigned":
      return issue.assignee === null;
    case "me-or-unassigned":
      return issue.assignee === null || issue.assignee === me;
    default:
      return issue.assignee === assignee;
  }
}

/** Whether the issue passes the filter's chips; an empty list in a chip lets everything through. */
export function passes(graph: Graph, issue: Issue, filter: Partial<IssueFilter>, me: string | null) {
  const within = <Value>(chosen: Value[] | undefined, value: Value) => !chosen || chosen.length === 0 || chosen.includes(value);
  return (
    (within(filter.statuses, issue.status) || within(filter.statuses, effectiveStatus(graph, issue))) &&
    within(filter.types, issue.type) &&
    within(filter.priorities, issue.priority) &&
    assigneeMatches(issue, filter.assignee ?? "anyone", me) &&
    (!filter.labels || filter.labels.length === 0 || filter.labels.some((label) => issue.labels.includes(label))) &&
    (!filter.epic || graph.epicOf(issue)?.id === filter.epic || issue.id === filter.epic)
  );
}

/** Words that all appear in the id or the title, case aside: the view's instant search; the host adds the long texts. */
export function titleMatches(issue: Pick<Issue, "id" | "title">, query: string) {
  const haystack = `${issue.id} ${issue.title}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

const SORTS: Record<SortBy, (a: Issue, b: Issue) => number> = {
  priority: byPriorityThenUpdated,
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  id: (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }),
};

export interface Row {
  issue: Issue;
  depth: number;
  hasChildren: boolean;
}

export interface Group {
  key: string;
  title: string;
  /** The epic a group by epic stands for. */
  epic: Issue | null;
  rows: Row[];
}

const STATUS_ORDER = ["in_progress", "open", "blocked", "deferred", "closed"];

function groupKeyOf(graph: Graph, issue: Issue, by: GroupBy): { key: string; title: string; epic: Issue | null } {
  switch (by) {
    case "epic": {
      const epic = issue.type === "epic" ? issue : graph.epicOf(issue);
      return epic ? { key: epic.id, title: epic.title, epic } : { key: "", title: "No epic", epic: null };
    }
    case "status": {
      const status = effectiveStatus(graph, issue);
      return { key: status, title: status.replace("_", " "), epic: null };
    }
    case "type":
      return { key: issue.type, title: issue.type, epic: null };
    case "priority":
      return { key: String(issue.priority), title: `P${issue.priority}`, epic: null };
    case "none":
      return { key: "", title: "", epic: null };
  }
}

/** Rows in the order the list shows them: with `tree`, each child right under its parent when both are shown. */
export function rowsOf(issues: Issue[], sort: SortBy, tree: boolean): Row[] {
  const sorted = [...issues].sort(SORTS[sort]);
  if (!tree) return sorted.map((issue) => ({ issue, depth: 0, hasChildren: false }));
  const shown = new Set(sorted.map(({ id }) => id));
  const kids = new Map<string, Issue[]>();
  sorted.forEach((issue) => {
    if (issue.parent && shown.has(issue.parent)) kids.set(issue.parent, [...(kids.get(issue.parent) ?? []), issue]);
  });
  const placed = new Set<string>();
  const walk = (issue: Issue, depth: number): Row[] => {
    if (placed.has(issue.id)) return [];
    placed.add(issue.id);
    const children = kids.get(issue.id) ?? [];
    return [{ issue, depth, hasChildren: children.length > 0 }, ...children.flatMap((child) => walk(child, depth + 1))];
  };
  return sorted.filter((issue) => !issue.parent || !shown.has(issue.parent)).flatMap((root) => walk(root, 0));
}

export function groupsOf(graph: Graph, issues: Issue[], by: GroupBy, sort: SortBy, tree: boolean): Group[] {
  const buckets = new Map<string, { title: string; epic: Issue | null; issues: Issue[] }>();
  issues.forEach((issue) => {
    const { key, title, epic } = groupKeyOf(graph, issue, by);
    const bucket = buckets.get(key) ?? { title, epic, issues: [] };
    bucket.issues.push(issue);
    buckets.set(key, bucket);
  });
  const order = (a: [string, { epic: Issue | null }], b: [string, { epic: Issue | null }]) => {
    if (by === "status") return STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0]);
    if (by === "priority") return Number(a[0]) - Number(b[0]);
    if (by === "epic") return Number(a[0] === "") - Number(b[0] === "") || (a[1].epic && b[1].epic ? byPriorityThenUpdated(a[1].epic, b[1].epic) : 0);
    return a[0].localeCompare(b[0]);
  };
  return [...buckets.entries()].sort(order).map(([key, { title, epic, issues: grouped }]) => {
    const rows = rowsOf(
      grouped.filter((issue) => !(by === "epic" && issue.id === key)),
      sort,
      tree,
    );
    return { key, title, epic, rows };
  });
}

/** A memory's group: the first word of its key. */
export const memoryGroupOf = (memory: Memory) => memory.key.split(/[-_.:]/)[0] || memory.key;

export function memoryGroups(memories: Memory[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  memories.forEach((memory) => counts.set(memoryGroupOf(memory), (counts.get(memoryGroupOf(memory)) ?? 0) + 1));
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** A memory key as a title: "android-background-freezer" reads "Android background freezer". */
export function memoryTitle(key: string) {
  const words = key.split(/[-_]+/).filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function memoryMatches(memory: Memory, query: string) {
  const haystack = `${memory.key} ${memory.text}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** The issues whose updatedAt moved, or that are new, between two reads. */
export function changedBetween(before: Issue[] | null, after: Issue[]): string[] {
  if (!before) return [];
  const was = new Map(before.map((issue) => [issue.id, issue.updatedAt]));
  return after.filter((issue) => was.get(issue.id) !== issue.updatedAt).map(({ id }) => id);
}
