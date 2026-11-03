import type { RawIssue } from "../beads/normalize.ts";
import type { Ran, Runner } from "../beads/run.ts";
import { ProgramMissing } from "../beads/run.ts";
import { COMMENTS, ISSUES, JOURNAL, ME, MEMORIES } from "./fixtures/beads.ts";

/**
 * Answers bd's commands about the Kite fixtures as bd would, and keeps what the writes change. `calls` records every
 * command, so tests can count reads. The journal keeps records from seq `oldestKept` on, and refuses older ones as bd
 * does once it has pruned them.
 */
export class FakeBeads {
  issues = structuredClone(ISSUES) as RawIssue[];
  memories = { ...MEMORIES };
  comments = structuredClone(COMMENTS);
  journal = structuredClone(JOURNAL) as { seq: number }[];
  oldestKept = 41;
  journalOn = true;
  installed = true;
  hasDatabase = true;
  calls: string[][] = [];
  /** Makes the next writes fail as a guard does. */
  guardFails = false;

  constructor(readonly beadsDir = "/work/kite/.beads") {}

  readonly runner: Runner = async (program, args) => {
    if (program === "git") return ok(`${ME}\n`);
    if (!this.installed) throw new ProgramMissing("bd");
    this.calls.push(args);
    return this.answer(args);
  };

  reads(command: string) {
    return this.calls.filter(([first]) => first === command).length;
  }

  private find(id: string | undefined) {
    return this.issues.find((issue) => issue.id === id);
  }

  private touch(issue: RawIssue) {
    issue.updated_at = new Date(Date.parse(issue.updated_at) + 60_000).toISOString().replace(".000", "");
  }

  answer(args: string[]): Ran {
    const [command, sub] = args;
    const flag = (name: string) => {
      const at = args.indexOf(name);
      return at >= 0 ? args[at + 1] : undefined;
    };
    const flags = (name: string) => args.flatMap((arg, index) => (arg === name ? [args[index + 1]!] : []));
    if (!this.hasDatabase && command !== "where") return fail("Error: no beads database found");
    switch (command) {
      case "where":
        return this.hasDatabase ? ok(`${this.beadsDir}\n  prefix: kt\n  database: ${this.beadsDir}/embeddeddolt\n`) : fail("Error: no beads database found");
      case "list":
        return ok(JSON.stringify(this.issues));
      case "memories":
        return ok(JSON.stringify({ ...this.memories, schema_version: 1 }));
      case "comments":
        return ok(JSON.stringify(this.comments[sub!] ?? []));
      case "config":
        return ok(this.journalOn ? "true\n" : "false\n");
      case "events": {
        const since = Number(flag("--since"));
        if (since < this.oldestKept - 1)
          return fail(`Error: events journal truncated: checkpoint ${since} is below the retained window [${this.oldestKept}..99]\nHint: resume with --since ${this.oldestKept - 1} to continue`);
        return ok(this.journal.filter(({ seq }) => seq > since).map((record) => JSON.stringify(record)).join("\n"));
      }
      case "remember":
        this.memories[flag("--key")!] = args.at(-1)!;
        return ok("");
      case "forget":
        delete this.memories[sub!];
        return ok("");
      case "dep": {
        const [, , id, on] = args;
        const issue = this.find(id);
        if (!issue) return fail(`Error: issue ${id} not found`);
        const others = (issue.dependencies ?? []).filter(({ depends_on_id }) => depends_on_id !== on);
        issue.dependencies = sub === "add" ? [...others, { issue_id: id!, depends_on_id: on!, type: flag("--type") ?? "blocks" }] : others;
        this.touch(issue);
        return ok("");
      }
      case "create": {
        const id = `kt-${this.issues.length + 10}`;
        const parent = flag("--parent");
        this.issues.push({
          id: parent ? `${parent}.${this.issues.filter((issue) => issue.parent === parent).length + 1}` : id,
          title: flag("--title")!,
          status: "open",
          issue_type: flag("--type") ?? "task",
          priority: Number(flag("--priority") ?? 2),
          ...(parent && { parent }),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return ok(JSON.stringify({ id: this.issues.at(-1)!.id }));
      }
    }
    const issue = this.find(sub);
    if (!issue) return fail(`Error: issue ${sub} not found`);
    if (this.guardFails) return { code: 13, stdout: "", stderr: `Error: status mismatch on ${sub}` };
    switch (command) {
      case "update": {
        if (args.includes("--claim")) Object.assign(issue, { status: "in_progress", assignee: ME });
        const ifStatus = flag("--if-status");
        if (ifStatus !== undefined && issue.status !== ifStatus) return { code: 13, stdout: "", stderr: `Error: status mismatch: ${sub} has status "${issue.status}", expected "${ifStatus}"` };
        const ifAssignee = flag("--if-assignee");
        if (ifAssignee !== undefined && (issue.assignee ?? "") !== ifAssignee) return { code: 13, stdout: "", stderr: `Error: assignee mismatch on ${sub}` };
        if (flag("--status") !== undefined) issue.status = flag("--status")!;
        if (flag("--priority") !== undefined) issue.priority = Number(flag("--priority"));
        if (flag("--type") !== undefined) issue.issue_type = flag("--type")!;
        if (flag("--assignee") !== undefined) issue.assignee = flag("--assignee") || undefined;
        if (flag("--title") !== undefined) issue.title = flag("--title")!;
        if (flag("--description") !== undefined) issue.description = flag("--description");
        if (flag("--notes") !== undefined) issue.notes = flag("--notes");
        if (flag("--append-notes") !== undefined) issue.notes = issue.notes ? `${issue.notes}\n${flag("--append-notes")}` : flag("--append-notes");
        if (flag("--parent") !== undefined) issue.parent = flag("--parent") || undefined;
        issue.labels = [...(issue.labels ?? []).filter((label) => !flags("--remove-label").includes(label)), ...flags("--add-label").filter((label) => !(issue.labels ?? []).includes(label))];
        this.touch(issue);
        return ok(`✓ Updated issue: ${sub}`);
      }
      case "unclaim":
        Object.assign(issue, { status: "open", assignee: undefined });
        this.touch(issue);
        return ok("");
      case "comment":
        (this.comments[sub!] ??= []).push({ id: `c${Date.now()}`, issue_id: sub!, author: ME, text: args[2]!, created_at: new Date().toISOString() });
        issue.comment_count = (issue.comment_count ?? 0) + 1;
        return ok("");
      case "close":
        Object.assign(issue, { status: "closed", closed_at: new Date().toISOString(), close_reason: flag("--reason") });
        this.touch(issue);
        return ok("");
      case "reopen":
        Object.assign(issue, { status: "open", closed_at: undefined });
        this.touch(issue);
        return ok("");
      case "defer":
        issue.status = "deferred";
        this.touch(issue);
        return ok("");
    }
    return fail(`The fake bd doesn't know: bd ${args.join(" ")}`);
  }
}

const ok = (stdout: string): Ran => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): Ran => ({ code: 1, stdout: "", stderr });
