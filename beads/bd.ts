import type { BdProblem, Undo, WriteAction } from "./model.ts";
import type { Ran } from "./run.ts";
import { ProgramMissing } from "./run.ts";

export const listArgs = () => ["list", "--all", "--json", "--limit", "0"];
export const memoriesArgs = () => ["memories", "--json"];
export const commentsArgs = (id: string) => ["comments", id, "--json"];
export const whereArgs = () => ["where"];
export const journalOnArgs = () => ["config", "get", "events-journal"];
export const eventsArgs = (since: number) => ["events", "tail", "--since", String(since)];

const labelFlags = (add: string[], remove: string[]) => [...add.flatMap((label) => ["--add-label", label]), ...remove.flatMap((label) => ["--remove-label", label])];

const TEXT_FLAGS = { title: "--title", description: "--description", design: "--design", acceptance: "--acceptance", notes: "--notes" } as const;

/** The bd command a write runs, which the view shows beside it. */
export function writeArgs(action: WriteAction): string[] {
  switch (action.kind) {
    case "claim":
      return ["update", action.id, "--claim"];
    case "unclaim":
      return ["unclaim", action.id];
    case "status":
      return ["update", action.id, "--status", action.status];
    case "priority":
      return ["update", action.id, "--priority", String(action.priority)];
    case "type":
      return ["update", action.id, "--type", action.type];
    case "assignee":
      return ["update", action.id, "--assignee", action.assignee ?? ""];
    case "labels":
      return ["update", action.id, ...labelFlags(action.add, action.remove)];
    case "append-note":
      return ["update", action.id, "--append-notes", action.text];
    case "edit":
      return ["update", action.id, TEXT_FLAGS[action.field], action.value];
    case "comment":
      return ["comment", action.id, action.text];
    case "close":
      return ["close", action.id, ...(action.reason.trim() ? ["--reason", action.reason.trim()] : [])];
    case "reopen":
      return ["reopen", action.id];
    case "defer":
      return ["defer", action.id, ...(action.until.trim() ? [`--until=${action.until.trim()}`] : [])];
    case "create":
      return [
        "create",
        "--title",
        action.title.trim(),
        "--type",
        action.type,
        "--priority",
        String(action.priority),
        ...(action.parent ? ["--parent", action.parent] : []),
        ...(action.description.trim() ? ["--description", action.description] : []),
        ...(action.labels.length > 0 ? ["--labels", action.labels.join(",")] : []),
        "--json",
      ];
    case "link":
      return ["dep", "add", action.id, action.on, "--type", action.type];
    case "unlink":
      return ["dep", "remove", action.id, action.on];
    case "parent":
      return ["update", action.id, "--parent", action.parent ?? ""];
    case "remember":
      return ["remember", "--key", action.key.trim(), action.text];
    case "forget":
      return ["forget", action.key];
  }
}

/**
 * The bd command that puts a small edit back, guarded where bd can guard: a status only moves back while it still
 * holds what the edit set, so an agent's later change isn't undone.
 */
export function undoArgs(undo: Undo): string[] {
  switch (undo.kind) {
    case "status":
      return ["update", undo.id, "--status", undo.from, "--if-status", undo.to];
    case "claim":
      return ["unclaim", undo.id];
    case "priority":
      return ["update", undo.id, "--priority", String(undo.from)];
    case "type":
      return ["update", undo.id, "--type", undo.from];
    case "assignee":
      return ["update", undo.id, "--assignee", undo.from ?? "", "--if-assignee", undo.to ?? ""];
    case "labels":
      return ["update", undo.id, ...labelFlags(undo.removed, undo.added)];
    case "notes":
      return ["update", undo.id, "--notes", undo.from];
    case "memory":
      return ["remember", "--key", undo.key, undo.text];
  }
}

/** bd exits 13 when a guard finds the field changed since. */
export const GUARD_FAILED = 13;

const firstLine = (output: string) =>
  output
    .split("\n")
    .map((line) => line.replace(/^Error:\s*/, "").trim())
    .find(Boolean) ?? "";

export function problemOf(failure: Ran | ProgramMissing): BdProblem {
  if (failure instanceof ProgramMissing) return { code: "not-installed", message: failure.message };
  const said = firstLine(failure.stderr) || firstLine(failure.stdout) || `bd exited with ${failure.code}.`;
  if (/no beads database|not initialized|no \.beads/i.test(said)) return { code: "no-database", message: said };
  return { code: "failed", message: said };
}

export function shellText(args: string[]) {
  const quoted = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);
  return ["bd", ...args.map((arg) => (arg.length > 80 ? `${quoted(arg.slice(0, 77))}…` : quoted(arg)))].join(" ");
}
