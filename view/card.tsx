import type { Issue } from "../beads/model.ts";
import { idWithTitle, useTab } from "./bridge.ts";
import { ago } from "./format.ts";
import { Avatar, Labels, PriorityBadge, TypeBadge } from "./icons.tsx";

export const DRAGGED_TYPE = "application/x-beads-issue";

/** Why an issue can't start: what it waits for, each with a few words of its title. */
export function WaitsFor({ issue }: { issue: Issue }) {
  const { graph } = useTab();
  const blockers = graph.openBlockers(issue);
  if (blockers.length === 0) return null;
  return (
    <span className="waits">
      ⛔ waits for{" "}
      {blockers.map((blocker, index) => (
        <span key={blocker.id}>
          {index > 0 && ", "}
          {idWithTitle(graph, blocker.id, 4)}
        </span>
      ))}
    </span>
  );
}

export function Card({ issue, actions }: { issue: Issue; actions?: React.ReactNode }) {
  const tab = useTab();
  const epic = tab.graph.epicOf(issue);
  const selected = tab.selected?.id === issue.id;
  const changed = tab.state.changed.includes(issue.id);
  return (
    <article
      className={["card", selected && "selected", changed && "changed", issue.status === "closed" && "closed"].filter(Boolean).join(" ")}
      data-id={issue.id}
      draggable={issue.status !== "closed"}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAGGED_TYPE, issue.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <button type="button" className="card-open" aria-label={`${issue.title} · ${issue.id}`} onClick={() => tab.select(issue)} />
      {epic && <span className="crumb">▸ {epic.title}</span>}
      <span className="card-title">{issue.title}</span>
      <WaitsFor issue={issue} />
      <span className="card-foot">
        <TypeBadge type={issue.type} />
        <PriorityBadge priority={issue.priority} />
        <span className="id">{issue.id}</span>
        <Labels issue={issue} />
        <span className="spacer" />
        {issue.status === "closed" ? <span className="muted small">{ago(issue.closedAt ?? issue.updatedAt)}</span> : issue.assignee && <Avatar name={issue.assignee} />}
        {actions}
      </span>
    </article>
  );
}
