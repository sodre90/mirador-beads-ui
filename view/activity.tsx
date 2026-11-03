import { useEffect } from "react";
import type { ActivityEntry, Issue } from "../beads/model.ts";
import { idWithTitle, send, useTab } from "./bridge.ts";
import { eventWords } from "./detail.tsx";
import { dayOf } from "./format.ts";
import { Spinner, TypeBadge } from "./icons.tsx";

const RECENT_WITHOUT_JOURNAL = 80;

/** Without the journal, what the issues' own times tell: created, closed, or updated. */
function fromTimes(issues: Issue[]): ActivityEntry[] {
  return issues
    .flatMap((issue) => [
      { at: issue.createdAt, op: "create", issue },
      ...(issue.closedAt ? [{ at: issue.closedAt, op: "close", issue }] : []),
      ...(issue.updatedAt !== issue.createdAt && issue.updatedAt !== issue.closedAt ? [{ at: issue.updatedAt, op: "update", issue }] : []),
    ])
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_WITHOUT_JOURNAL)
    .map(({ at, op, issue }, index) => ({ seq: -index, at, op, issueId: issue.id, title: issue.title, actor: "", changes: [], dep: null }));
}

export function ActivityView() {
  const tab = useTab();
  const { state, graph } = tab;
  useEffect(() => {
    void send({ kind: "activity" }).catch(() => {});
  }, []);
  if (state.activity === null)
    return (
      <div className="empty">
        <Spinner /> Reading the journal…
      </div>
    );
  const entries = state.journal ? state.activity : fromTimes(graph.issues);
  const days = new Map<string, ActivityEntry[]>();
  entries.forEach((entry) => days.set(dayOf(entry.at), [...(days.get(dayOf(entry.at)) ?? []), entry]));
  return (
    <div className="activity">
      {!state.journal && <p className="muted small pad">This database keeps no events journal, so this shows created, updated and closed times only. Turn it on with bd config set events-journal true.</p>}
      {[...days.entries()].map(([day, dayEntries]) => (
        <section key={day} className="day">
          <h3>{day}</h3>
          <ul>
            {dayEntries.map((entry) => {
              const issue = graph.byId.get(entry.issueId);
              return (
                <li key={`${entry.seq}:${entry.issueId}`}>
                  <span className="time">{new Date(entry.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                  {issue ? <TypeBadge type={issue.type} /> : <span className="type-gap" />}
                  <span className="activity-text">
                    <button type="button" className="activity-title" onClick={() => tab.select(entry.issueId)}>
                      {issue?.title ?? entry.title} <span className="id">{entry.issueId}</span>
                    </button>
                    <span className="activity-what">
                      {entry.actor && <b>{entry.actor} </b>}
                      {state.journal ? eventWords(entry, (id) => idWithTitle(graph, id, 4)) : entry.op === "create" ? "created it" : entry.op === "close" ? "closed it" : "changed it"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {entries.length === 0 && <p className="empty">Nothing happened yet.</p>}
    </div>
  );
}
