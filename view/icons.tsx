import { useState } from "react";
import type { Issue } from "../beads/model.ts";

const TYPE_LETTERS: Record<string, string> = { task: "T", bug: "B", feature: "F", chore: "C", epic: "E", decision: "D", spike: "S", story: "S", milestone: "M" };

export const TYPE_WORDS: Record<string, string> = { task: "Task", bug: "Bug", feature: "Feature", chore: "Chore", epic: "Epic", decision: "Decision", spike: "Spike" };

export const STATUS_WORDS: Record<string, string> = { open: "Open", ready: "Ready", in_progress: "In progress", blocked: "Blocked", deferred: "Deferred", closed: "Closed", pinned: "Pinned", hooked: "Hooked" };

export const PRIORITY_WORDS = ["P0 · critical", "P1 · high", "P2 · normal", "P3 · low", "P4 · backlog"];

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className={`type t-${type}`} title={TYPE_WORDS[type] ?? type} aria-label={TYPE_WORDS[type] ?? type}>
      {TYPE_LETTERS[type] ?? type.charAt(0).toUpperCase()}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: number }) {
  return (
    <span className={`priority p${priority}`} title={PRIORITY_WORDS[priority]}>
      P{priority}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status s-${status}`}>{STATUS_WORDS[status] ?? status.replace("_", " ")}</span>;
}

const AVATAR_COLORS = ["#e8590c", "#7f56d9", "#0e9384", "#2e90fa", "#c11574", "#4e5ba6", "#ca8504"];

export function Avatar({ name, size = 18 }: { name: string; size?: number }) {
  const color = AVATAR_COLORS[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.55 }} title={name} aria-hidden>
      {name.charAt(0)}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" role="status" />;
}

/** The id in mono, which copies itself when clicked. */
export function IdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="id-chip"
      aria-label={`Copy ${id}`}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {id}
      <span className="copy-mark">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}

export function Labels({ issue }: { issue: Pick<Issue, "labels"> }) {
  return (
    <>
      {issue.labels.map((label) => (
        <span key={label} className="label">
          {label}
        </span>
      ))}
    </>
  );
}
