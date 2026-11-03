import { useState } from "react";
import { canClose, effectiveStatus, openEpics, rowsOf, type Progress } from "../beads/derive.ts";
import { planText } from "../beads/handoff.ts";
import type { Issue } from "../beads/model.ts";
import { failureText, useTab } from "./bridge.ts";
import { WaitsFor } from "./card.tsx";
import { ago } from "./format.ts";
import { PriorityBadge, StatusBadge, TypeBadge } from "./icons.tsx";
import { useSearchMatch } from "./now.tsx";

function ProgressBar({ progress }: { progress: Progress }) {
  const part = (count: number, className: string) => count > 0 && <i className={className} style={{ flexGrow: count }} />;
  return (
    <div className="progress" role="img" aria-label={`${progress.done} of ${progress.total} done`}>
      {part(progress.done, "done")}
      {part(progress.inProgress, "wip")}
      {part(progress.blocked, "blocked")}
      {part(progress.open + progress.deferred, "rest")}
    </div>
  );
}

const STATE_MARKS: Record<string, string> = { closed: "✓", in_progress: "◐", blocked: "⛔", deferred: "❄", open: "○" };

function Tree({ epic }: { epic: Issue }) {
  const tab = useTab();
  const { graph } = tab;
  const [showDone, setShowDone] = useState(false);
  const work = graph.descendants(epic.id);
  const rows = rowsOf(
    work.filter((issue) => showDone || issue.status !== "closed"),
    "priority",
    true,
  );
  const done = work.filter((issue) => issue.status === "closed").length;
  return (
    <div className="tree">
      {rows.map(({ issue, depth }) => {
        const status = effectiveStatus(graph, issue);
        return (
          <button key={issue.id} type="button" className={`tree-row s-${status} ${tab.selected?.id === issue.id ? "selected" : ""}`} style={{ paddingLeft: 8 + depth * 18 }} onClick={() => tab.select(issue)}>
            <span className="mark">{STATE_MARKS[status] ?? "○"}</span>
            <TypeBadge type={issue.type} />
            <span className="tree-title">{issue.title}</span>
            <span className="id">{issue.id}</span>
            {status === "blocked" ? <WaitsFor issue={issue} /> : status !== "open" && status !== "closed" && <StatusBadge status={status} />}
            <PriorityBadge priority={issue.priority} />
          </button>
        );
      })}
      <div className="tree-foot">
        {done > 0 && (
          <button type="button" className="link" onClick={() => setShowDone(!showDone)}>
            {showDone ? "Hide" : "Show"} {done} done
          </button>
        )}
        <button type="button" className="link" onClick={() => tab.showSheet({ kind: "create", parent: epic })}>
          ＋ Add a child
        </button>
        <button type="button" className="link" onClick={() => void window.mirador.startConversation(planText(epic, work.filter((issue) => graph.isReady(issue)))).catch((error) => tab.toast(failureText(error), { failed: true }))}>
          Plan it with the agent
        </button>
      </div>
    </div>
  );
}

export function EpicsView() {
  const tab = useTab();
  const searched = useSearchMatch();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const epics = openEpics(tab.graph).filter(({ epic }) => searched(epic) || tab.graph.descendants(epic.id).some(searched));
  const toggle = (id: string) => setOpen((was) => new Set(was.has(id) ? [...was].filter((each) => each !== id) : [...was, id]));
  if (epics.length === 0)
    return (
      <div className="empty">
        <p>{tab.query ? "No epic matches." : "No open epics."}</p>
        <p className="muted">An epic groups the work toward one goal: create one with type Epic, then add children to it.</p>
      </div>
    );
  return (
    <div className="epics">
      {epics.map(({ epic, progress, next }) => {
        const expanded = open.has(epic.id);
        const closable = canClose(progress);
        return (
          <section key={epic.id} className={`epic ${expanded ? "expanded" : ""} ${tab.state.changed.includes(epic.id) ? "changed" : ""}`} aria-label={epic.title}>
            <div className="epic-head">
              <button type="button" className="epic-toggle" aria-expanded={expanded} aria-label={`${expanded ? "Fold" : "Unfold"} ${epic.title}`} onClick={() => toggle(epic.id)}>
                {expanded ? "▾" : "▸"}
              </button>
              <div className="epic-main">
                <button type="button" className="epic-title" onClick={() => tab.select(epic)}>
                  <TypeBadge type="epic" />
                  {epic.title}
                  <PriorityBadge priority={epic.priority} />
                  <span className="id">{epic.id}</span>
                </button>
                <div className="epic-meta">
                  {closable ? (
                    <>
                      <b className="ok">All {progress.total} done.</b>
                      <button type="button" className="link strong" onClick={() => tab.showSheet({ kind: "close", issue: epic })}>
                        Close the epic…
                      </button>
                    </>
                  ) : next ? (
                    <>
                      Next ready:{" "}
                      <button type="button" className="link" onClick={() => tab.select(next)}>
                        {next.title}
                      </button>
                    </>
                  ) : progress.total === 0 ? (
                    <span>No work under it yet.</span>
                  ) : (
                    <span>Nothing ready: the rest is in progress or waits.</span>
                  )}
                  <span className="muted">updated {ago(epic.updatedAt)}</span>
                </div>
              </div>
              <div className="epic-progress">
                <ProgressBar progress={progress} />
                <div className="epic-counts">
                  <span>
                    {progress.done} of {progress.total} done
                  </span>
                  {progress.inProgress > 0 && <span className="wip">{progress.inProgress} in progress</span>}
                  {progress.blocked > 0 && <span className="blocked">{progress.blocked} blocked</span>}
                  {progress.open > 0 && <span>{progress.open} open</span>}
                </div>
              </div>
            </div>
            {expanded && <Tree epic={epic} />}
          </section>
        );
      })}
    </div>
  );
}
