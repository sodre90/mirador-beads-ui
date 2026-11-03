import { useEffect, useState } from "react";
import { boardOf, openEpics } from "../beads/derive.ts";
import type { IssueFilter, View } from "../beads/model.ts";
import { idWithTitle, send, useTab } from "./bridge.ts";
import { agoText } from "./format.ts";
import { Spinner } from "./icons.tsx";
import { PickList, Popover } from "./popover.tsx";
import { PRIORITY_WORDS, STATUS_WORDS, TYPE_WORDS } from "./icons.tsx";

const VIEW_WORDS: Record<View, string> = { now: "Now", epics: "Epics", issues: "Issues", memories: "Memories", activity: "Activity" };

function useNow(every = 15_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

function Live() {
  const tab = useTab();
  const { state } = tab;
  useNow();
  const last = state.changed.at(-1);
  if (state.problem) return <span className="live off" data-hint={state.problem.message}>⚠ Can't read the database</span>;
  return (
    <span className="live" aria-live="polite">
      <i className={state.loading ? "reading" : ""} />
      {last ? (
        <>
          Live ·{" "}
          <button type="button" className="link" onClick={() => tab.select(last)}>
            {idWithTitle(tab.graph, last, 4)}
          </button>{" "}
          changed {agoText(new Date(state.loadedAt ?? Date.now()).toISOString())}
        </>
      ) : (
        <>Live · read {agoText(state.loadedAt ? new Date(state.loadedAt).toISOString() : null)}</>
      )}
    </span>
  );
}

export function TopBar() {
  const tab = useTab();
  const { graph, state } = tab;
  const [typed, setTyped] = useState(tab.query);
  useEffect(() => setTyped(tab.query), [tab.query]);
  useEffect(() => {
    const timer = setTimeout(() => typed !== tab.query && tab.setQuery(typed), 180);
    return () => clearTimeout(timer);
  }, [typed]);
  const counts: Partial<Record<View, number>> = {
    epics: openEpics(graph).length,
    issues: graph.issues.filter((issue) => issue.status !== "closed").length,
    memories: state.memories?.length ?? 0,
  };
  return (
    <header className="top-bar">
      <div className="views" role="tablist" aria-label="Views">
        {(Object.keys(VIEW_WORDS) as View[]).map((view, index) => (
          <button key={view} type="button" role="tab" aria-selected={tab.view === view} className={tab.view === view ? "on" : ""} onClick={() => tab.setView(view)} data-hint={`${VIEW_WORDS[view]} (${index + 1})`}>
            {VIEW_WORDS[view]}
            {counts[view] !== undefined && <span className="count">{counts[view]}</span>}
          </button>
        ))}
      </div>
      <div className="search">
        <span className="search-icon" aria-hidden>
          ⌕
        </span>
        <input
          id="beads-search"
          aria-label="Search"
          placeholder={tab.view === "memories" ? "Search memories…" : "Search titles, descriptions and notes…"}
          value={typed}
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setTyped("");
              tab.setQuery("");
              event.currentTarget.blur();
            }
          }}
        />
        {state.loading && <Spinner />}
      </div>
      <Live />
      <button type="button" className="button primary" data-hint={tab.view === "memories" ? "Remember something new (n)" : "New issue (n)"} onClick={() => tab.showSheet(tab.view === "memories" ? { kind: "memory", memory: null } : { kind: "create", parent: null })}>
        {tab.view === "memories" ? "+ Remember" : "+ New"}
      </button>
      <Popover className="icon-button" label="⋯" name="More" hint="More" align="right">
        {(close) => (
          <div className="menu">
            <button type="button" onClick={() => (close(), tab.refresh())}>
              <b>Read again now</b>
              <small>{state.connection?.beadsDir}</small>
            </button>
            <button type="button" className="danger" onClick={() => (close(), void send({ kind: "disconnect" }))}>
              <b>Disconnect this workspace</b>
              <small>The database stays as it is</small>
            </button>
          </div>
        )}
      </Popover>
    </header>
  );
}

function Chip({ name, value, children }: { name: string; value: string | null; children: (close: () => void) => React.ReactNode }) {
  return (
    <Popover className={`chip ${value ? "set" : ""}`} label={<>{value ? `${name}: ${value}` : name} ▾</>}>
      {children}
    </Popover>
  );
}

const many = (values: string[], words: Record<string, string>) => (values.length === 0 ? null : values.length === 1 ? (words[values[0]!] ?? values[0]!) : `${values.length}`);

const ASSIGNEE_WORDS = { anyone: "", me: "Me", unassigned: "Nobody", "me-or-unassigned": "Me and nobody" } as Record<string, string>;

/** The chips over a board or list: what part of the database it shows. */
export function FilterBar({
  filter,
  onChange,
  statuses = true,
  extra,
}: {
  filter: Partial<IssueFilter>;
  onChange(filter: Partial<IssueFilter>): void;
  statuses?: boolean;
  extra?: React.ReactNode;
}) {
  const { graph, state } = useTab();
  const set = (change: Partial<IssueFilter>) => onChange({ ...filter, ...change });
  const labels = [...new Set(graph.issues.flatMap((issue) => issue.labels))].sort();
  const assignees = [...new Set(graph.issues.flatMap((issue) => (issue.assignee ? [issue.assignee] : [])))].sort();
  const epics = openEpics(graph).map(({ epic }) => epic);
  const types = [...new Set(graph.issues.map((issue) => issue.type))].sort();
  const assignee = filter.assignee ?? "anyone";
  const any = (filter.statuses?.length ?? 0) + (filter.types?.length ?? 0) + (filter.priorities?.length ?? 0) + (filter.labels?.length ?? 0) > 0 || !!filter.epic || assignee !== "anyone";
  return (
    <div className="filters">
      {statuses && (
        <Chip name="Status" value={many(filter.statuses ?? [], STATUS_WORDS)}>
          {() => <PickList multiple options={["open", "in_progress", "blocked", "deferred", "closed"].map((value) => ({ value, text: STATUS_WORDS[value]! }))} chosen={filter.statuses ?? []} onChange={(statuses) => set({ statuses })} />}
        </Chip>
      )}
      <Chip name="Assignee" value={assignee === "anyone" ? null : (ASSIGNEE_WORDS[assignee] ?? assignee)}>
        {(close) => (
          <PickList
            multiple={false}
            filterLabel="Filter people"
            options={[
              { value: "me", text: `Me${state.me ? ` (${state.me})` : ""}` },
              { value: "me-or-unassigned", text: "Me and nobody" },
              { value: "unassigned", text: "Nobody" },
              ...assignees.filter((name) => name !== state.me).map((name) => ({ value: name, text: name })),
            ]}
            chosen={assignee === "anyone" ? [] : [assignee]}
            onChange={([picked]) => (set({ assignee: picked ?? "anyone" }), close())}
          />
        )}
      </Chip>
      <Chip name="Epic" value={filter.epic ? idWithTitle(graph, filter.epic, 3) : null}>
        {(close) => (
          <PickList multiple={false} filterLabel="Filter epics" options={epics.map((epic) => ({ value: epic.id, text: `${epic.title} · ${epic.id}` }))} chosen={filter.epic ? [filter.epic] : []} onChange={([picked]) => (set({ epic: picked ?? null }), close())} />
        )}
      </Chip>
      <Chip name="Type" value={many(filter.types ?? [], TYPE_WORDS)}>
        {() => <PickList multiple options={types.map((value) => ({ value, text: TYPE_WORDS[value] ?? value }))} chosen={filter.types ?? []} onChange={(picked) => set({ types: picked })} />}
      </Chip>
      <Chip name="Priority" value={many((filter.priorities ?? []).map(String), Object.fromEntries(PRIORITY_WORDS.map((words, index) => [String(index), `P${index}`])))}>
        {() => (
          <PickList
            multiple
            options={PRIORITY_WORDS.map((text, index) => ({ value: String(index), text }))}
            chosen={(filter.priorities ?? []).map(String)}
            onChange={(picked) => set({ priorities: picked.map(Number) })}
          />
        )}
      </Chip>
      {labels.length > 0 && (
        <Chip name="Label" value={many(filter.labels ?? [], {})}>
          {() => <PickList multiple filterLabel="Filter labels" options={labels.map((value) => ({ value, text: value }))} chosen={filter.labels ?? []} onChange={(picked) => set({ labels: picked })} />}
        </Chip>
      )}
      {any && (
        <button type="button" className="link clear" onClick={() => onChange({ statuses: statuses ? [] : undefined, types: [], priorities: [], labels: [], epic: null, assignee: "anyone" })}>
          Clear
        </button>
      )}
      <span className="spacer" />
      {extra}
    </div>
  );
}

/** The numbers the Now board stands on, for the filter bar's right side. */
export function BoardCounts() {
  const { graph } = useTab();
  const board = boardOf(graph, () => true);
  return (
    <span className="muted small">
      {board.inProgress.length} in progress · {board.ready.length} ready · {board.blocked.length} blocked
    </span>
  );
}
