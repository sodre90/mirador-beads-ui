import { useEffect, useState } from "react";
import { effectiveStatus } from "../beads/derive.ts";
import { mentionText, planText, workText } from "../beads/handoff.ts";
import { PRIORITIES, type ActivityEntry, type Comment, type Detail as DetailData, type Issue, type Link } from "../beads/model.ts";
import { failureText, idWithTitle, send, useTab } from "./bridge.ts";
import { WaitsFor } from "./card.tsx";
import { ago, agoText } from "./format.ts";
import { Avatar, IdChip, PRIORITY_WORDS, PriorityBadge, Spinner, STATUS_WORDS, StatusBadge, TYPE_WORDS, TypeBadge } from "./icons.tsx";
import { MarkdownText } from "./markdown.tsx";
import { PickList, Popover } from "./popover.tsx";

type Section = "details" | "dependencies" | "activity";

function useHandOff() {
  const tab = useTab();
  return (doIt: () => Promise<void>, done: string) =>
    doIt().then(
      () => tab.toast(done),
      (error) => tab.toast(failureText(error), { failed: true }),
    );
}

function WorkOnThis({ issue }: { issue: Issue }) {
  const tab = useTab();
  const handOff = useHandOff();
  const isEpic = issue.type === "epic";
  const text = () => (isEpic ? planText(issue, tab.graph.descendants(issue.id).filter((each) => tab.graph.isReady(each))) : workText(issue, tab.graph.epicOf(issue)));
  const start = () => handOff(() => window.mirador.startConversation(text()), "Started a conversation on it");
  return (
    <span className="split-button">
      <button type="button" id="work-on-this" className="button primary" data-hint="A new conversation in this workspace works on it (w)" onClick={start}>
        {isEpic ? "Plan with the agent" : "Work on this"}
      </button>
      <Popover className="button primary split-arrow" label="▾" name="More ways to hand it to the agent" hint="More ways to hand it to the agent">
        {(close) => (
          <div className="menu wide">
            <button type="button" onClick={() => (close(), start())}>
              <b>Start a conversation</b>
              <small>A new conversation in this workspace {isEpic ? "looks at the epic and plans it" : "works on it and claims it"}</small>
            </button>
            <button type="button" onClick={() => (close(), handOff(() => window.mirador.prompt(text()), "Sent to this conversation's agent"))}>
              <b>Send to this conversation</b>
              <small>The agent here gets it as your next message</small>
            </button>
            <button type="button" onClick={() => (close(), handOff(() => window.mirador.addToComposer(mentionText(issue)), "Added to the composer"))}>
              <b>Mention in the composer</b>
              <small>Adds “{mentionText(issue).slice(0, 50)}…” to what you're writing</small>
            </button>
          </div>
        )}
      </Popover>
    </span>
  );
}

function Picker({ label, children, value }: { label: string; value: React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  return (
    <Popover className="picker" label={<><small>{label}</small> {value} ▾</>} hint={`Change the ${label.toLowerCase()}`}>
      {children}
    </Popover>
  );
}

function Fields({ issue }: { issue: Issue }) {
  const tab = useTab();
  const { graph, state } = tab;
  const status = effectiveStatus(graph, issue);
  const people = [...new Set(graph.issues.flatMap((each) => (each.assignee ? [each.assignee] : [])))].sort();
  const knownLabels = [...new Set(graph.issues.flatMap((each) => each.labels))].sort();
  const [newLabel, setNewLabel] = useState("");
  const addLabel = (label: string, close: () => void) => {
    const clean = label.trim();
    if (!clean) return;
    setNewLabel("");
    close();
    void tab.edit({ kind: "labels", id: issue.id, add: [clean], remove: [] }, `Labelled ${issue.id} ${clean}`);
  };
  return (
    <div className="fields">
      <IdChip id={issue.id} />
      <Picker label="Status" value={<StatusBadge status={status} />}>
        {(close) => (
          <PickList
            multiple={false}
            options={["open", "in_progress", "blocked", "deferred"].map((value) => ({ value, text: STATUS_WORDS[value]! }))}
            chosen={[issue.status]}
            onChange={([picked]) => {
              close();
              if (picked && picked !== issue.status) void tab.edit({ kind: "status", id: issue.id, status: picked }, `${issue.id} is ${STATUS_WORDS[picked]!.toLowerCase()}`);
            }}
          />
        )}
      </Picker>
      <Picker label="Type" value={<><TypeBadge type={issue.type} /> {TYPE_WORDS[issue.type] ?? issue.type}</>}>
        {(close) => (
          <PickList
            multiple={false}
            options={Object.entries(TYPE_WORDS).map(([value, text]) => ({ value, text }))}
            chosen={[issue.type]}
            onChange={([picked]) => {
              close();
              if (picked && picked !== issue.type) void tab.edit({ kind: "type", id: issue.id, type: picked }, `${issue.id} is a ${TYPE_WORDS[picked]!.toLowerCase()}`);
            }}
          />
        )}
      </Picker>
      <Picker label="Priority" value={<PriorityBadge priority={issue.priority} />}>
        {(close) => (
          <PickList
            multiple={false}
            options={PRIORITIES.map((value) => ({ value: String(value), text: PRIORITY_WORDS[value]! }))}
            chosen={[String(issue.priority)]}
            onChange={([picked]) => {
              close();
              if (picked !== undefined && Number(picked) !== issue.priority) void tab.edit({ kind: "priority", id: issue.id, priority: Number(picked) }, `${issue.id} is P${picked}`);
            }}
          />
        )}
      </Picker>
      <Picker label="Assignee" value={issue.assignee ? <><Avatar name={issue.assignee} size={14} /> {issue.assignee}</> : <span className="muted">nobody</span>}>
        {(close) => (
          <PickList
            multiple={false}
            filterLabel="Filter people"
            options={[...(state.me ? [{ value: state.me, text: `${state.me} (me)` }] : []), { value: "", text: "Nobody" }, ...people.filter((name) => name !== state.me).map((name) => ({ value: name, text: name }))]}
            chosen={[issue.assignee ?? ""]}
            onChange={([picked]) => {
              close();
              const assignee = picked || null;
              if (picked !== undefined && assignee !== issue.assignee) void tab.edit({ kind: "assignee", id: issue.id, assignee }, assignee ? `Assigned ${issue.id} to ${assignee}` : `Unassigned ${issue.id}`);
            }}
          />
        )}
      </Picker>
      {issue.labels.map((label) => (
        <span key={label} className="label removable">
          {label}
          <button type="button" aria-label={`Remove the label ${label}`} onClick={() => void tab.edit({ kind: "labels", id: issue.id, add: [], remove: [label] }, `Took ${label} off ${issue.id}`)}>
            ×
          </button>
        </span>
      ))}
      <Popover className="picker" label="+ label" hint="Add a label">
        {(close) => (
          <div className="label-picker">
            <input
              autoFocus
              aria-label="New label"
              placeholder="New label"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && addLabel(newLabel, close)}
            />
            {knownLabels
              .filter((label) => !issue.labels.includes(label) && label.includes(newLabel.trim().toLowerCase()))
              .slice(0, 12)
              .map((label) => (
                <button key={label} type="button" onClick={() => addLabel(label, close)}>
                  {label}
                </button>
              ))}
          </div>
        )}
      </Popover>
      <span className="muted small">updated {agoText(issue.updatedAt)}</span>
    </div>
  );
}

function Actions({ issue }: { issue: Issue }) {
  const tab = useTab();
  const closed = issue.status === "closed";
  const mine = issue.status === "in_progress" && issue.assignee === tab.state.me;
  return (
    <div className="actions">
      {!closed && <WorkOnThis issue={issue} />}
      {!closed && issue.type !== "epic" && issue.status !== "in_progress" && (
        <button type="button" className="button" data-hint="In progress, assigned to you" onClick={() => void tab.edit({ kind: "claim", id: issue.id }, `Claimed ${issue.id}`)}>
          Claim
        </button>
      )}
      {mine && (
        <button type="button" className="button" data-hint="Back to open, unassigned" onClick={() => void tab.edit({ kind: "unclaim", id: issue.id }, `Released ${issue.id}`)}>
          Release
        </button>
      )}
      {closed ? (
        <button type="button" className="button" onClick={() => void tab.edit({ kind: "reopen", id: issue.id }, `Reopened ${issue.id}`)}>
          Reopen
        </button>
      ) : (
        <button type="button" className="button" data-hint="Close (x)" onClick={() => tab.showSheet({ kind: "close", issue })}>
          Close…
        </button>
      )}
      {!closed && issue.status !== "deferred" && (
        <button type="button" className="button" onClick={() => tab.showSheet({ kind: "defer", issue })}>
          Defer…
        </button>
      )}
      <button type="button" className="button" onClick={() => tab.showSheet({ kind: "note", issue })}>
        Add note
      </button>
      <Popover className="button icon-like" label="⋯" name="More actions" hint="More" align="right">
        {(close) => (
          <div className="menu">
            <button type="button" onClick={() => (close(), tab.showSheet({ kind: "create", parent: issue }))}>
              <b>Add a child</b>
              <small>A new issue under this one</small>
            </button>
            <button type="button" onClick={() => (close(), tab.showSheet({ kind: "link", issue }))}>
              <b>Link to another issue…</b>
              <small>Blocks, related, discovered from</small>
            </button>
            <button type="button" onClick={() => (close(), tab.showSheet({ kind: "edit", issue, field: "title", value: issue.title }))}>
              <b>Rename…</b>
            </button>
          </div>
        )}
      </Popover>
    </div>
  );
}

function TextSection({ issue, title, field, text, empty }: { issue: Issue; title: string; field: "description" | "design" | "acceptance" | "notes"; text: string; empty: string }) {
  const tab = useTab();
  return (
    <section className="text-section">
      <header>
        {title}
        <button type="button" className="link" onClick={() => tab.showSheet({ kind: "edit", issue, field, value: text })}>
          {text ? "Edit" : "Write"}
        </button>
      </header>
      <MarkdownText text={text} empty={empty} />
    </section>
  );
}

function IssueLink({ id, why }: { id: string; why?: React.ReactNode }) {
  const tab = useTab();
  const other = tab.graph.byId.get(id);
  return (
    <button type="button" className={`dep-node ${other ? `s-${effectiveStatus(tab.graph, other)}` : ""}`} onClick={() => tab.select(id)}>
      {other && <TypeBadge type={other.type} />}
      <span className="dep-title">{other?.title ?? id}</span>
      <span className="id">{id}</span>
      {other && other.status !== "open" && <StatusBadge status={effectiveStatus(tab.graph, other)} />}
      {why}
    </button>
  );
}

const LINK_WORDS: Record<string, [string, string]> = {
  related: ["Related to", "Related to"],
  "discovered-from": ["Found while working on", "Led to"],
  duplicates: ["Duplicates", "Duplicated by"],
  supersedes: ["Supersedes", "Superseded by"],
};

function Dependencies({ issue, links }: { issue: Issue; links: Link[] }) {
  const tab = useTab();
  const { graph } = tab;
  const blockers = issue.blockedBy;
  const blocking = graph.blocking.get(issue.id) ?? [];
  const children = graph.children.get(issue.id) ?? [];
  const parent = issue.parent;
  const unlink = (on: string) => void tab.edit({ kind: "unlink", id: issue.id, on }, `Unlinked ${issue.id} from ${on}`);
  return (
    <div className="dependencies">
      {parent && (
        <div className="dep-group">
          <h4>Part of</h4>
          <IssueLink id={parent} />
        </div>
      )}
      <div className="dep-map">
        <div className="dep-column">
          <h4>Waits for</h4>
          {blockers.length === 0 && <p className="muted small">Nothing</p>}
          {blockers.map((id) => (
            <span key={id} className="dep-with-remove">
              <IssueLink id={id} />
              <button type="button" className="remove" aria-label={`Stop waiting for ${id}`} onClick={() => unlink(id)}>
                ×
              </button>
            </span>
          ))}
        </div>
        <span className="dep-arrow" aria-hidden>
          →
        </span>
        <div className="dep-column me">
          <h4>This</h4>
          <div className="dep-node me">
            <TypeBadge type={issue.type} />
            <span className="dep-title">{issue.title}</span>
          </div>
        </div>
        <span className="dep-arrow" aria-hidden>
          →
        </span>
        <div className="dep-column">
          <h4>Holds back</h4>
          {blocking.length === 0 && <p className="muted small">Nothing</p>}
          {blocking.map((other) => (
            <IssueLink key={other.id} id={other.id} />
          ))}
        </div>
      </div>
      {children.length > 0 && (
        <div className="dep-group">
          <h4>
            Children <span className="count">{children.length}</span>
          </h4>
          {children.map((child) => (
            <IssueLink key={child.id} id={child.id} />
          ))}
        </div>
      )}
      {links.length > 0 && (
        <div className="dep-group">
          <h4>Other links</h4>
          {links.map((link) => (
            <IssueLink key={`${link.direction}:${link.type}:${link.id}`} id={link.id} why={<span className="link-kind">{(LINK_WORDS[link.type] ?? [link.type, link.type])[link.direction === "out" ? 0 : 1]}</span>} />
          ))}
        </div>
      )}
      <button type="button" className="button" onClick={() => tab.showSheet({ kind: "link", issue })}>
        Link to another issue…
      </button>
    </div>
  );
}

const FIELD_WORDS: Record<string, string> = { status: "status", priority: "priority", type: "type", assignee: "assignee", title: "title", description: "description", design: "design", acceptance: "acceptance criteria", notes: "notes", labels: "labels" };
const SHORT_FIELDS = new Set(["status", "priority", "type", "assignee"]);

function valueText(field: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "none";
  if (field === "priority") return `P${value}`;
  if (field === "status") return STATUS_WORDS[String(value)] ?? String(value);
  if (Array.isArray(value)) return value.join(", ") || "none";
  return String(value);
}

/** One journal entry in words: what happened, and to short fields what they became. */
export function eventWords(entry: ActivityEntry, nameOf: (id: string) => string): React.ReactNode {
  if (entry.op === "create") return "created it";
  if (entry.op === "close") return "closed it";
  if (entry.op === "reopen") return "reopened it";
  if (entry.op === "comment") return "commented";
  if (entry.op === "dep_add" && entry.dep) return entry.dep.kind === "blocks" ? <>made it wait for {nameOf(entry.dep.target)}</> : entry.dep.kind === "parent-child" ? <>put it under {nameOf(entry.dep.target)}</> : <>linked it ({entry.dep.kind}) to {nameOf(entry.dep.target)}</>;
  if (entry.op === "dep_remove" && entry.dep) return <>unlinked it from {nameOf(entry.dep.target)}</>;
  if (entry.changes.length === 0) return entry.op === "update" ? "changed it" : entry.op.replace("_", " ");
  return entry.changes.map((change, index) => (
    <span key={change.field}>
      {index > 0 && ", "}
      {SHORT_FIELDS.has(change.field) ? (
        <>
          {FIELD_WORDS[change.field]}{" "}
          <span className="diff">
            <s>{valueText(change.field, change.from)}</s> → {valueText(change.field, change.to)}
          </span>
        </>
      ) : (
        <>changed the {FIELD_WORDS[change.field] ?? change.field}</>
      )}
    </span>
  ));
}

type TimelineItem = { at: string; key: string; comment?: Comment; entry?: ActivityEntry; words?: string; who?: string };

function CommentBox({ issue }: { issue: Issue }) {
  const tab = useTab();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const post = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const done = await tab.edit({ kind: "comment", id: issue.id, text }, "Comment posted");
    setBusy(false);
    if (done) {
      setText("");
      setPreview(false);
    }
  };
  return (
    <div className="comment-box">
      <div className="write-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={!preview} className={!preview ? "on" : ""} onClick={() => setPreview(false)}>
          Write
        </button>
        <button type="button" role="tab" aria-selected={preview} className={preview ? "on" : ""} onClick={() => setPreview(true)}>
          Preview
        </button>
      </div>
      {preview ? (
        <div className="preview">
          <MarkdownText text={text} empty="Nothing to preview." />
        </div>
      ) : (
        <textarea
          id="comment-text"
          aria-label="Comment"
          placeholder="Write a comment… (Markdown, ⌘↵ posts)"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => (event.metaKey || event.ctrlKey) && event.key === "Enter" && void post()}
        />
      )}
      <div className="comment-buttons">
        <span className="muted small">bd comment {issue.id} …</span>
        <span className="spacer" />
        <button type="button" className="button primary" disabled={busy || !text.trim()} onClick={() => void post()}>
          {busy && <Spinner />} Comment
        </button>
      </div>
    </div>
  );
}

function Activity({ issue, detail }: { issue: Issue; detail: DetailData | null }) {
  const tab = useTab();
  const entries = (tab.state.activity ?? []).filter((entry) => entry.issueId === issue.id && entry.op !== "comment");
  const items: TimelineItem[] = [
    ...(detail?.comments ?? []).map((comment) => ({ at: comment.at, key: `c:${comment.id}`, comment })),
    ...entries.map((entry) => ({ at: entry.at, key: `e:${entry.seq}`, entry })),
    ...(entries.some(({ op }) => op === "create") ? [] : [{ at: issue.createdAt, key: "created", words: "created it", who: detail?.createdBy ?? undefined }]),
    ...(issue.closedAt && !entries.some(({ op }) => op === "close") ? [{ at: issue.closedAt, key: "closed", words: issue.closeReason ? `closed it: ${issue.closeReason}` : "closed it" }] : []),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="timeline">
      {!tab.state.journal && <p className="muted small">This database keeps no events journal, so only comments and the created and closed times show. Turn it on with bd config set events-journal true.</p>}
      {items.map((item) =>
        item.comment ? (
          <article key={item.key} className="comment">
            <Avatar name={item.comment.author || "?"} size={24} />
            <div className="comment-body">
              <header>
                <b>{item.comment.author}</b> commented · {ago(item.comment.at)}
              </header>
              <MarkdownText text={item.comment.text} />
            </div>
          </article>
        ) : (
          <div key={item.key} className="event">
            <span className="event-dot" />
            {item.entry?.actor || item.who ? <b>{item.entry?.actor || item.who}</b> : null} {item.entry ? eventWords(item.entry, (id) => idWithTitle(tab.graph, id, 4)) : item.words} <span className="muted">· {ago(item.at)}</span>
          </div>
        ),
      )}
      <CommentBox issue={issue} />
    </div>
  );
}

export function Detail({ issue }: { issue: Issue }) {
  const tab = useTab();
  const [section, setSection] = useState<Section>("details");
  const result = tab.state.details[issue.id];
  const detail = result?.detail ?? null;
  useEffect(() => {
    if (section === "activity" && tab.state.activity === null) void send({ kind: "activity" }).catch(() => {});
  }, [section]);
  const ancestors = tab.graph.ancestors(issue);
  const links = detail?.links ?? [];
  const depCount = issue.blockedBy.length + (tab.graph.blocking.get(issue.id)?.length ?? 0) + links.length + (tab.graph.children.get(issue.id)?.length ?? 0);
  return (
    <section className={`detail ${tab.state.changed.includes(issue.id) ? "changed" : ""}`} aria-label={`Issue ${issue.id}`}>
      <div className="detail-top">
        {ancestors.length > 0 ? (
          <nav className="crumbs" aria-label="Parents">
            {ancestors.map((ancestor) => (
              <button key={ancestor.id} type="button" className="link" onClick={() => tab.select(ancestor)}>
                {ancestor.title} ›
              </button>
            ))}
          </nav>
        ) : (
          <span />
        )}
        <button type="button" className="icon-button" aria-label="Close the issue's panel" data-hint="Close (Esc)" onClick={() => tab.select(null)}>
          ✕
        </button>
      </div>
      <h1 className="detail-title">{issue.title}</h1>
      <Fields issue={issue} />
      <WaitsFor issue={issue} />
      {issue.status === "deferred" && issue.deferUntil && <p className="note-line">❄ Deferred until {issue.deferUntil}: it comes back to open then.</p>}
      {issue.status === "closed" && issue.closeReason && <p className="note-line">✓ Closed {agoText(issue.closedAt)}: {issue.closeReason}</p>}
      <Actions issue={issue} />
      <div className="sections" role="tablist">
        <button type="button" role="tab" aria-selected={section === "details"} className={section === "details" ? "on" : ""} onClick={() => setSection("details")}>
          Details
        </button>
        <button type="button" role="tab" aria-selected={section === "dependencies"} className={section === "dependencies" ? "on" : ""} onClick={() => setSection("dependencies")}>
          Dependencies <span className="count">{depCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={section === "activity"} className={section === "activity" ? "on" : ""} onClick={() => setSection("activity")}>
          Activity <span className="count">{issue.comments}</span>
        </button>
      </div>
      {!detail && !result?.problem && (
        <p className="muted">
          <Spinner /> Reading it…
        </p>
      )}
      {result?.problem && <p className="problem-line">⚠ {result.problem.message}</p>}
      {detail && section === "details" && (
        <div className="texts">
          <TextSection issue={issue} title="Description" field="description" text={detail.description} empty="No description." />
          {(detail.design || issue.type !== "bug") && <TextSection issue={issue} title="Design" field="design" text={detail.design} empty="No design written." />}
          <TextSection issue={issue} title="Acceptance criteria" field="acceptance" text={detail.acceptance} empty="None written." />
          <TextSection issue={issue} title="Notes" field="notes" text={detail.notes} empty="No notes." />
        </div>
      )}
      {section === "dependencies" && <Dependencies issue={issue} links={links} />}
      {section === "activity" && <Activity issue={issue} detail={detail} />}
      <p className="muted small detail-foot">
        Created {agoText(issue.createdAt)}
        {detail?.createdBy ? ` by ${detail.createdBy}` : ""}
      </p>
    </section>
  );
}
