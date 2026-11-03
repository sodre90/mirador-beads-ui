import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceTab, WorkspaceTabContext } from "../mirador/api.ts";
import { commentsArgs, eventsArgs, GUARD_FAILED, journalOnArgs, listArgs, memoriesArgs, problemOf, undoArgs, whereArgs, writeArgs } from "./bd.ts";
import { changedBetween } from "./derive.ts";
import {
  DEFAULT_PREFS,
  type ActivityEntry,
  type BdProblem,
  type Candidate,
  type Connection,
  type DetailResult,
  type Issue,
  type Memory,
  type Prefs,
  type SearchReply,
  type TabAction,
  type TabState,
  type Undo,
  type WriteAction,
  type WriteReply,
} from "./model.ts";
import { activityOf, commentOf, detailOf, issueOf, memoriesOf, whereOf, type RawIssue } from "./normalize.ts";
import { ProgramMissing, spawnRunner, type Ran, type Runner } from "./run.ts";

/** Reads of one workspace's database stay this far apart, however many views poll it, so agents' writes don't queue behind them. */
export const MIN_RELOAD_GAP_MS = 3000;
/** Without a Dolt manifest to watch, the tab reads again this often. */
export const TIMED_RELOAD_MS = 30_000;
const KEPT_DETAILS = 30;
const KEPT_JOURNAL_LINES = 1500;
const SHOWN_ACTIVITY = 400;
const SEARCH_RESULTS = 200;
const SNIPPET_CHARS = 140;

interface WorkspaceCache {
  candidate: Candidate | null | undefined;
  problem: BdProblem | null;
  raw: RawIssue[] | null;
  issues: Issue[] | null;
  memories: Memory[] | null;
  details: Map<string, DetailResult & { version: string }>;
  journal: boolean | null;
  journalLines: string[];
  lastSeq: number | null;
  activity: ActivityEntry[] | null;
  changed: string[];
  loadedAt: number | null;
  reloading: Promise<void> | null;
  /** A write landed while a read ran, so another read follows it. */
  readAgain: boolean;
  lastReloadAt: number;
  signature: string | null;
  me: string | null | undefined;
}

const emptyCache = (): WorkspaceCache => ({
  candidate: undefined,
  problem: null,
  raw: null,
  issues: null,
  memories: null,
  details: new Map(),
  journal: null,
  journalLines: [],
  lastSeq: null,
  activity: null,
  changed: [],
  loadedAt: null,
  reloading: null,
  readAgain: false,
  lastReloadAt: 0,
  signature: null,
  me: undefined,
});

class BdFailed extends Error {
  constructor(
    readonly problem: BdProblem,
    readonly code: number | null = null,
    /** All bd said, where hints past the first line live. */
    readonly said = "",
  ) {
    super(problem.message);
  }
}

const isConnection = (value: unknown): value is Connection =>
  !!value && typeof value === "object" && typeof (value as Connection).beadsDir === "string" && typeof (value as Connection).prefix === "string";

const prefsOf = (value: unknown): Prefs => {
  const stored = (value && typeof value === "object" ? value : {}) as Partial<Prefs>;
  return { ...DEFAULT_PREFS, ...stored, filter: { ...DEFAULT_PREFS.filter, ...(stored.filter ?? {}) }, nowFilter: { ...DEFAULT_PREFS.nowFilter, ...(stored.nowFilter ?? {}) } };
};

/** The Dolt manifest of an embedded database, whose text changes with each write and with nothing else. */
function manifestOf(beadsDir: string): string | null {
  const embedded = join(beadsDir, "embeddeddolt");
  if (!existsSync(embedded)) return null;
  const database = readdirSync(embedded).find((name) => existsSync(join(embedded, name, ".dolt", "noms", "manifest")));
  return database ? join(embedded, database, ".dolt", "noms", "manifest") : null;
}

const hashOf = (path: string) => {
  try {
    return createHash("sha1").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
};

const keepNewest = <Value>(map: Map<string, Value>, key: string, value: Value, most: number) => {
  map.delete(key);
  map.set(key, value);
  while (map.size > most) map.delete(map.keys().next().value!);
};

/** The lowest sequence bd still keeps, from its refusal to tail from before it. */
const oldestKeptSeq = (said: string) => Number(/--since (\d+)/.exec(said)?.[1] ?? NaN);

function snippetOf(text: string, word: string) {
  const at = text.toLowerCase().indexOf(word);
  if (at < 0) return null;
  const start = Math.max(0, at - SNIPPET_CHARS / 3);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + SNIPPET_CHARS).replace(/\s+/g, " ").trim()}…`;
}

/** The Beads tab of every workspace: its database read with bd, and the user's edits written with bd. */
/** What a kept detail was read at: bd adds a comment without touching the issue's updated time. */
const versionOf = (raw: RawIssue | undefined) => (raw ? `${raw.updated_at}·${raw.comment_count ?? 0}` : "");

export class BeadsTab implements WorkspaceTab<TabState> {
  private readonly caches = new Map<string, WorkspaceCache>();

  constructor(
    private readonly run: Runner = spawnRunner,
    private readonly now: () => number = Date.now,
  ) {}

  private cacheOf(context: WorkspaceTabContext) {
    const known = this.caches.get(context.workspace.id);
    if (known) return known;
    const cache = emptyCache();
    this.caches.set(context.workspace.id, cache);
    return cache;
  }

  private connectionOf(context: WorkspaceTabContext): Connection | null {
    const stored = context.storage.get("connection");
    return isConnection(stored) ? stored : null;
  }

  /** Cheap, as Mirador asks at every switch to the workspace: a .beads folder here, or a database connected before. */
  shows(context: WorkspaceTabContext) {
    return this.connectionOf(context) !== null || existsSync(join(context.workspace.folder, ".beads"));
  }

  async state(context: WorkspaceTabContext): Promise<TabState> {
    const cache = this.cacheOf(context);
    const connection = this.connectionOf(context);
    if (!connection && cache.candidate === undefined) await this.detect(context, cache);
    return {
      connection,
      candidate: cache.candidate ?? null,
      problem: cache.problem,
      issues: cache.issues,
      memories: cache.memories,
      details: Object.fromEntries([...cache.details].map(([id, { detail, problem, fetchedAt }]) => [id, { detail, problem, fetchedAt }])),
      activity: cache.activity,
      journal: cache.journal === true,
      changed: cache.changed,
      loadedAt: cache.loadedAt,
      loading: cache.reloading !== null,
      me: cache.me ?? null,
      prefs: prefsOf(context.storage.get("prefs")),
    };
  }

  async action(action: unknown, context: WorkspaceTabContext): Promise<unknown> {
    const asked = action as TabAction;
    switch (asked.kind) {
      case "connect":
        return this.connect(context);
      case "disconnect":
        context.storage.set("connection", undefined);
        this.caches.set(context.workspace.id, emptyCache());
        context.changed();
        return null;
      case "poll":
        await this.poll(context);
        return null;
      case "refresh":
        await this.reload(context, true);
        return null;
      case "open":
        await this.open(context, asked.id);
        return null;
      case "search":
        return this.search(context, asked.text);
      case "activity":
        await this.fetchActivity(context);
        return null;
      case "prefs":
        context.storage.set("prefs", prefsOf(asked.prefs));
        context.changed();
        return null;
      case "undo":
        return this.undo(context, asked.undo);
      default:
        return this.write(context, asked);
    }
  }

  private async bd(context: WorkspaceTabContext, args: string[]): Promise<string> {
    let ran: Ran;
    try {
      ran = await this.run("bd", args, { cwd: context.workspace.folder });
    } catch (error) {
      if (!(error instanceof ProgramMissing)) throw error;
      const problem = problemOf(error);
      this.cacheOf(context).problem = problem;
      throw new BdFailed(problem);
    }
    if (ran.code !== 0) throw new BdFailed(problemOf(ran), ran.code, `${ran.stderr}\n${ran.stdout}`);
    return ran.stdout;
  }

  private async detect(context: WorkspaceTabContext, cache: WorkspaceCache) {
    try {
      const where = whereOf(await this.bd(context, whereArgs()));
      if (!where) {
        cache.candidate = null;
        return;
      }
      const issues = (JSON.parse(await this.bd(context, listArgs())) as unknown[]).length;
      cache.candidate = { ...where, issues };
    } catch (error) {
      if (!(error instanceof BdFailed)) throw error;
      cache.candidate = null;
      if (error.problem.code !== "not-installed") cache.problem = null;
    }
  }

  private async connect(context: WorkspaceTabContext) {
    const cache = this.cacheOf(context);
    if (cache.candidate === undefined || cache.candidate === null) await this.detect(context, cache);
    if (cache.problem) throw new Error(cache.problem.message);
    if (!cache.candidate) throw new Error("bd finds no beads database in this workspace's folder. Run bd init there first.");
    const { beadsDir, prefix } = cache.candidate;
    context.storage.set("connection", { beadsDir, prefix });
    await this.reload(context, true);
    return { connected: { beadsDir, prefix } };
  }

  private connected(context: WorkspaceTabContext) {
    const connection = this.connectionOf(context);
    if (!connection) throw new Error("Connect the workspace to its beads database first.");
    return connection;
  }

  /** The view asks every few seconds while it shows; this reads again only when the database changed, or the timer ran out. */
  private async poll(context: WorkspaceTabContext) {
    const connection = this.connected(context);
    const cache = this.cacheOf(context);
    const manifest = manifestOf(connection.beadsDir);
    if (manifest) {
      if (hashOf(manifest) !== cache.signature) await this.reload(context, false);
      return;
    }
    if (this.now() - cache.lastReloadAt >= TIMED_RELOAD_MS) await this.reload(context, false);
  }

  /**
   * One read of the issues and memories at a time for each workspace, and none sooner than MIN_RELOAD_GAP_MS after
   * the last unless `soon` asks (a write the user waits to see).
   */
  private reload(context: WorkspaceTabContext, soon: boolean): Promise<void> {
    const cache = this.cacheOf(context);
    if (cache.reloading) {
      if (soon) cache.readAgain = true;
      return cache.reloading;
    }
    if (!soon && this.now() - cache.lastReloadAt < MIN_RELOAD_GAP_MS) return Promise.resolve();
    const connection = this.connected(context);
    const manifest = manifestOf(connection.beadsDir);
    cache.signature = manifest ? hashOf(manifest) : null;
    cache.lastReloadAt = this.now();
    cache.reloading = this.readAll(context, cache).finally(() => {
      cache.reloading = null;
      cache.lastReloadAt = this.now();
      context.changed();
      if (cache.readAgain) {
        cache.readAgain = false;
        void this.reload(context, true);
      }
    });
    context.changed();
    return cache.reloading;
  }

  private async readAll(context: WorkspaceTabContext, cache: WorkspaceCache) {
    try {
      const [list, memories, me] = await Promise.all([
        this.bd(context, listArgs()),
        this.bd(context, memoriesArgs()).catch(() => "{}"),
        cache.me === undefined ? this.whoAmI(context) : Promise.resolve(cache.me),
      ]);
      const raw = JSON.parse(list) as RawIssue[];
      const issues = raw.map(issueOf);
      cache.changed = changedBetween(cache.issues, issues);
      cache.raw = raw;
      cache.issues = issues;
      cache.memories = memoriesOf(JSON.parse(memories) as Record<string, unknown>);
      cache.me = me;
      cache.problem = null;
      cache.loadedAt = this.now();
      await this.refreshOpenDetails(context, cache);
      if (cache.activity !== null) await this.fetchActivity(context).catch(() => {});
    } catch (error) {
      if (!(error instanceof BdFailed)) throw error;
      cache.problem = error.problem;
    }
  }

  /** Who bd writes as, in bd's own order: what `--claim` puts in the assignee, so "mine" means the same here. */
  private async whoAmI(context: WorkspaceTabContext): Promise<string | null> {
    if (process.env.BEADS_ACTOR) return process.env.BEADS_ACTOR;
    const gitName = await this.run("git", ["config", "user.name"], { cwd: context.workspace.folder }).then(
      (ran) => (ran.code === 0 ? ran.stdout.trim() : ""),
      () => "",
    );
    return gitName || process.env.USER || null;
  }

  private async refreshOpenDetails(context: WorkspaceTabContext, cache: WorkspaceCache) {
    const stale = [...cache.details.entries()].filter(([id, kept]) => versionOf(cache.raw?.find((raw) => raw.id === id)) !== kept.version);
    await Promise.all(stale.map(([id]) => this.fetchDetail(context, cache, id)));
  }

  private async open(context: WorkspaceTabContext, id: string) {
    const cache = this.cacheOf(context);
    if (!cache.raw) await this.reload(context, true);
    const kept = cache.details.get(id);
    const raw = cache.raw?.find((issue) => issue.id === id);
    if (kept && raw && kept.version === versionOf(raw)) {
      keepNewest(cache.details, id, kept, KEPT_DETAILS);
      return;
    }
    await this.fetchDetail(context, cache, id);
    context.changed();
  }

  private async fetchDetail(context: WorkspaceTabContext, cache: WorkspaceCache, id: string) {
    const raw = cache.raw?.find((issue) => issue.id === id);
    if (!raw) {
      keepNewest(cache.details, id, { detail: null, problem: { code: "failed", message: `There's no issue ${id} in this database.` }, fetchedAt: this.now(), version: "" }, KEPT_DETAILS);
      return;
    }
    try {
      const comments = (raw.comment_count ?? 0) > 0 ? (JSON.parse(await this.bd(context, commentsArgs(id))) as Record<string, unknown>[]).map(commentOf) : [];
      keepNewest(cache.details, id, { detail: detailOf(raw, cache.raw!, comments), problem: null, fetchedAt: this.now(), version: versionOf(raw) }, KEPT_DETAILS);
    } catch (error) {
      if (!(error instanceof BdFailed)) throw error;
      keepNewest(cache.details, id, { detail: detailOf(raw, cache.raw!, []), problem: error.problem, fetchedAt: this.now(), version: versionOf(raw) }, KEPT_DETAILS);
    }
  }

  /** Every word in the id, title or a long text; the view matches titles itself, and this finds the rest. */
  private search(context: WorkspaceTabContext, text: string): SearchReply {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const raw = this.cacheOf(context).raw ?? [];
    if (words.length === 0) return { ids: [], snippets: {} };
    const longTexts = (issue: RawIssue) => [issue.description, issue.design, issue.acceptance_criteria, issue.notes].filter(Boolean).join("\n");
    const found = raw.filter((issue) => {
      const haystack = `${issue.id} ${issue.title}\n${longTexts(issue)}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
    const shown = found.slice(0, SEARCH_RESULTS);
    const snippets = Object.fromEntries(shown.flatMap((issue) => words.map((word) => snippetOf(longTexts(issue), word)).filter(Boolean).slice(0, 1).map((snippet) => [issue.id, snippet!])));
    return { ids: shown.map(({ id }) => id), snippets };
  }

  /** The journal's newest records, read from where the last read stopped; from the oldest bd keeps the first time. */
  private async fetchActivity(context: WorkspaceTabContext) {
    const cache = this.cacheOf(context);
    if (cache.journal === null) cache.journal = (await this.bd(context, journalOnArgs()).catch(() => "")).trim() === "true";
    if (!cache.journal) {
      cache.activity = [];
      context.changed();
      return;
    }
    const since = cache.lastSeq ?? 0;
    let output: string;
    try {
      output = await this.bd(context, eventsArgs(since));
    } catch (error) {
      if (!(error instanceof BdFailed)) throw error;
      const oldest = oldestKeptSeq(error.said);
      if (!Number.isFinite(oldest)) throw error;
      output = await this.bd(context, eventsArgs(oldest));
    }
    const lines = output.split("\n").filter((line) => line.startsWith("{"));
    cache.journalLines = [...cache.journalLines, ...lines].slice(-KEPT_JOURNAL_LINES);
    const entries = activityOf(cache.journalLines);
    cache.lastSeq = entries.at(-1)?.seq ?? cache.lastSeq;
    cache.activity = entries.slice(-SHOWN_ACTIVITY).reverse();
    context.changed();
  }

  private issueNow(context: WorkspaceTabContext, id: string): Issue {
    const issue = this.cacheOf(context).issues?.find((each) => each.id === id);
    if (!issue) throw new Error(`There's no issue ${id} in this database.`);
    return issue;
  }

  private notesNow(context: WorkspaceTabContext, id: string) {
    return this.cacheOf(context).raw?.find((raw) => raw.id === id)?.notes ?? "";
  }

  /** How to put the write back, from what the cache holds before it runs; null for writes that ask first or only add. */
  private undoFor(context: WorkspaceTabContext, action: WriteAction): Undo | null {
    switch (action.kind) {
      case "claim": {
        const { status, assignee } = this.issueNow(context, action.id);
        return { kind: "claim", id: action.id, from: { status, assignee } };
      }
      case "status":
        return { kind: "status", id: action.id, from: this.issueNow(context, action.id).status, to: action.status };
      case "priority":
        return { kind: "priority", id: action.id, from: this.issueNow(context, action.id).priority, to: action.priority };
      case "type":
        return { kind: "type", id: action.id, from: this.issueNow(context, action.id).type, to: action.type };
      case "assignee":
        return { kind: "assignee", id: action.id, from: this.issueNow(context, action.id).assignee, to: action.assignee };
      case "labels": {
        const labels = this.issueNow(context, action.id).labels;
        return { kind: "labels", id: action.id, added: action.add.filter((label) => !labels.includes(label)), removed: action.remove.filter((label) => labels.includes(label)) };
      }
      case "append-note": {
        const from = this.notesNow(context, action.id);
        return { kind: "notes", id: action.id, from, to: from ? `${from}\n${action.text}` : action.text };
      }
      case "forget": {
        const memory = this.cacheOf(context).memories?.find(({ key }) => key === action.key);
        return memory ? { kind: "memory", key: memory.key, text: memory.text } : null;
      }
      default:
        return null;
    }
  }

  private async write(context: WorkspaceTabContext, action: WriteAction): Promise<WriteReply> {
    this.connected(context);
    const undo = this.undoFor(context, action);
    let output: string;
    try {
      output = await this.bd(context, writeArgs(action));
    } catch (error) {
      if (error instanceof BdFailed) throw new Error(error.problem.message);
      throw error;
    }
    const created = action.kind === "create" ? createdIdOf(output) : undefined;
    void this.reload(context, true);
    return { done: true, undo, ...(created && { id: created }) };
  }

  /** Puts a small edit back unless the field changed since, so an agent's later change stays. */
  private async undo(context: WorkspaceTabContext, undo: Undo): Promise<WriteReply> {
    this.connected(context);
    await this.reload(context, true);
    const changedSince = () => new Error("It changed since, so Undo would overwrite someone else's change.");
    if (undo.kind === "priority" && this.issueNow(context, undo.id).priority !== undo.to) throw changedSince();
    if (undo.kind === "type" && this.issueNow(context, undo.id).type !== undo.to) throw changedSince();
    if (undo.kind === "notes" && this.notesNow(context, undo.id) !== undo.to) throw changedSince();
    if (undo.kind === "claim" && this.issueNow(context, undo.id).status !== "in_progress") throw changedSince();
    try {
      await this.bd(context, undoArgs(undo));
    } catch (error) {
      if (!(error instanceof BdFailed)) throw error;
      throw error.code === GUARD_FAILED ? changedSince() : new Error(error.problem.message);
    }
    void this.reload(context, true);
    return { done: true, undo: null };
  }
}

function createdIdOf(output: string): string | undefined {
  try {
    const created = JSON.parse(output) as { id?: unknown };
    return typeof created.id === "string" ? created.id : undefined;
  } catch {
    return /\b([a-z0-9]+-[a-z0-9]+(?:\.\d+)*)\b/i.exec(output)?.[1];
  }
}
