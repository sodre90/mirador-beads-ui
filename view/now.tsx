import { useState } from "react";
import { boardOf, DONE_DAYS, passes, titleMatches } from "../beads/derive.ts";
import type { Issue } from "../beads/model.ts";
import { useTab } from "./bridge.ts";
import { Card, DRAGGED_TYPE } from "./card.tsx";
import { BoardCounts, FilterBar } from "./top.tsx";

const SHOWN_PER_COLUMN = 40;

/** Whether the issue passes the search: the view matches titles, and the host's search adds the long texts. */
export function useSearchMatch() {
  const { query, found } = useTab();
  const ids = new Set(found?.ids ?? []);
  return (issue: Issue) => !query.trim() || titleMatches(issue, query) || ids.has(issue.id);
}

function Column({ title, issues, drop, empty, hint, cardActions }: { title: string; issues: Issue[]; drop?: { words: string; onDrop(id: string): void }; empty: string; hint?: string; cardActions?: (issue: Issue) => React.ReactNode }) {
  const [over, setOver] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? issues : issues.slice(0, SHOWN_PER_COLUMN);
  return (
    <section
      className={`column ${over ? "over" : ""}`}
      aria-label={title}
      onDragOver={(event) => {
        if (!drop || !event.dataTransfer.types.includes(DRAGGED_TYPE)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const id = event.dataTransfer.getData(DRAGGED_TYPE);
        if (drop && id) drop.onDrop(id);
      }}
    >
      <h3>
        {title} <span className="count">{issues.length}</span>
        {hint && <span className="column-hint">{hint}</span>}
      </h3>
      {drop && over && <div className="drop">{drop.words}</div>}
      <div className="cards">
        {shown.map((issue) => (
          <Card key={issue.id} issue={issue} actions={cardActions?.(issue)} />
        ))}
        {issues.length === 0 && <p className="column-empty">{empty}</p>}
        {issues.length > shown.length && (
          <button type="button" className="link more" onClick={() => setAll(true)}>
            Show {issues.length - shown.length} more
          </button>
        )}
      </div>
    </section>
  );
}

export function NowView() {
  const tab = useTab();
  const { graph, prefs, state } = tab;
  const searched = useSearchMatch();
  const board = boardOf(graph, (issue) => passes(graph, issue, prefs.nowFilter, state.me) && searched(issue));
  const claim = (id: string) => {
    const issue = graph.byId.get(id);
    if (!issue || issue.status === "in_progress") return;
    void tab.edit({ kind: "claim", id }, `Claimed ${id}`);
  };
  const close = (id: string) => {
    const issue = graph.byId.get(id);
    if (issue && issue.status !== "closed") tab.showSheet({ kind: "close", issue });
  };
  return (
    <div className="now">
      <FilterBar statuses={false} filter={prefs.nowFilter} onChange={(nowFilter) => tab.setPrefs({ ...prefs, nowFilter: { ...prefs.nowFilter, ...nowFilter } })} extra={<BoardCounts />} />
      <div className="board">
        <Column title="In progress" issues={board.inProgress} drop={{ words: "Drop to claim", onDrop: claim }} empty="Nothing in progress. Drag a ready card here to claim it." />
        <Column
          title="Ready"
          hint="by priority"
          issues={board.ready}
          empty="Nothing ready: everything open waits for something."
          cardActions={(issue) => (
            <button type="button" className="mini" data-hint="Claim it: in progress, assigned to you" onClick={() => claim(issue.id)}>
              Claim
            </button>
          )}
        />
        <Column title="Blocked" issues={board.blocked} empty="Nothing waits for anything." />
        <Column title="Done" hint={`last ${DONE_DAYS} days`} issues={board.done} drop={{ words: "Drop to close…", onDrop: close }} empty={`Nothing closed in the last ${DONE_DAYS} days.`} />
      </div>
    </div>
  );
}
