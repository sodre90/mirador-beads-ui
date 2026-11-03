import { useState } from "react";
import { effectiveStatus, groupsOf, passes, progressOf, type Row } from "../beads/derive.ts";
import type { GroupBy, SortBy } from "../beads/model.ts";
import { useTab } from "./bridge.ts";
import { WaitsFor } from "./card.tsx";
import { ago } from "./format.ts";
import { Avatar, Labels, PriorityBadge, StatusBadge, TypeBadge } from "./icons.tsx";
import { useSearchMatch } from "./now.tsx";
import { PickList, Popover } from "./popover.tsx";
import { FilterBar } from "./top.tsx";

const GROUP_WORDS: Record<GroupBy, string> = { epic: "Epic", status: "Status", type: "Type", priority: "Priority", none: "None" };
const SORT_WORDS: Record<SortBy, string> = { priority: "Priority", updated: "Recently updated", created: "Newest", id: "ID" };
const SHOWN_PER_GROUP = 60;

function IssueRow({ row }: { row: Row }) {
  const tab = useTab();
  const { issue, depth } = row;
  const status = effectiveStatus(tab.graph, issue);
  const snippet = tab.found?.snippets[issue.id];
  return (
    <li>
      <button
        type="button"
        className={["row", tab.selected?.id === issue.id && "selected", tab.state.changed.includes(issue.id) && "changed", issue.status === "closed" && "closed"].filter(Boolean).join(" ")}
        style={{ paddingLeft: 12 + depth * 18 }}
        data-id={issue.id}
        aria-current={tab.selected?.id === issue.id}
        onClick={() => tab.select(issue)}
      >
        <TypeBadge type={issue.type} />
        <span className="row-main">
          <span className="row-title">{issue.title}</span>
          <span className="row-meta">
            <span className="id">{issue.id}</span>
            {status !== "open" && <StatusBadge status={status} />}
            {issue.assignee && (
              <>
                <Avatar name={issue.assignee} size={14} /> {issue.assignee}
              </>
            )}
            <Labels issue={issue} />
            <span className="muted">· {ago(issue.updatedAt)}</span>
          </span>
          {status === "blocked" && <WaitsFor issue={issue} />}
          {snippet && <span className="snippet">{snippet}</span>}
        </span>
        <PriorityBadge priority={issue.priority} />
      </button>
    </li>
  );
}

function GroupHead({ title, epicId, count, folded, onFold }: { title: string; epicId: string | null; count: number; folded: boolean; onFold(): void }) {
  const tab = useTab();
  const progress = epicId ? progressOf(tab.graph, epicId) : null;
  if (!title) return null;
  return (
    <div className="group-head">
      <button type="button" className="group-fold" aria-expanded={!folded} onClick={onFold}>
        {folded ? "▸" : "▾"} {title}
      </button>
      {epicId && (
        <button type="button" className="id link" onClick={() => tab.select(epicId)}>
          {epicId}
        </button>
      )}
      <span className="spacer" />
      <span className="muted">{progress ? `${progress.done}/${progress.total} done` : count}</span>
    </div>
  );
}

export function IssuesView() {
  const tab = useTab();
  const { graph, prefs, state } = tab;
  const searched = useSearchMatch();
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [unfoldedAll, setUnfoldedAll] = useState<Set<string>>(new Set());
  const shown = graph.issues.filter((issue) => passes(graph, issue, prefs.filter, state.me) && searched(issue));
  const groups = groupsOf(graph, shown, prefs.group, prefs.sort, prefs.tree);
  const fold = (key: string) => setFolded((was) => new Set(was.has(key) ? [...was].filter((each) => each !== key) : [...was, key]));
  return (
    <section className="list" aria-label="Issues">
      <FilterBar
        filter={prefs.filter}
        onChange={(filter) => tab.setPrefs({ ...prefs, filter: { ...prefs.filter, ...filter } })}
        extra={
          <>
            <Popover className="chip" label={<>Group: {GROUP_WORDS[prefs.group]} ▾</>} align="right">
              {(close) => <PickList multiple={false} options={(Object.keys(GROUP_WORDS) as GroupBy[]).map((value) => ({ value, text: GROUP_WORDS[value] }))} chosen={[prefs.group]} onChange={([group]) => (tab.setPrefs({ ...prefs, group: group ?? "none" }), close())} />}
            </Popover>
            <Popover className="chip" label={<>Sort: {SORT_WORDS[prefs.sort]} ▾</>} align="right">
              {(close) => <PickList multiple={false} options={(Object.keys(SORT_WORDS) as SortBy[]).map((value) => ({ value, text: SORT_WORDS[value] }))} chosen={[prefs.sort]} onChange={([sort]) => (tab.setPrefs({ ...prefs, sort: sort ?? "priority" }), close())} />}
            </Popover>
            <button type="button" className={`chip ${prefs.tree ? "set" : ""}`} aria-pressed={prefs.tree} data-hint="Children under their parent" onClick={() => tab.setPrefs({ ...prefs, tree: !prefs.tree })}>
              Tree
            </button>
          </>
        }
      />
      <div className="list-body">
        {groups.map((group) => {
          const isFolded = folded.has(group.key);
          const rows = unfoldedAll.has(group.key) ? group.rows : group.rows.slice(0, SHOWN_PER_GROUP);
          return (
            <div key={group.key || "all"} className="group">
              <GroupHead title={group.title} epicId={group.epic?.id ?? null} count={group.rows.length} folded={isFolded} onFold={() => fold(group.key)} />
              {!isFolded && (
                <ul>
                  {rows.map((row) => (
                    <IssueRow key={row.issue.id} row={row} />
                  ))}
                </ul>
              )}
              {!isFolded && group.rows.length > rows.length && (
                <button type="button" className="link more" onClick={() => setUnfoldedAll((was) => new Set([...was, group.key]))}>
                  Show {group.rows.length - rows.length} more
                </button>
              )}
            </div>
          );
        })}
        {shown.length === 0 && (
          <div className="empty">
            <p>Nothing matches.</p>
            <p className="muted">Change the chips or the search to see more.</p>
          </div>
        )}
      </div>
    </section>
  );
}
