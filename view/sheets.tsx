import { useEffect, useRef, useState, type ReactNode } from "react";
import { shellText, writeArgs } from "../beads/bd.ts";
import { isClosed, titleMatches } from "../beads/derive.ts";
import { PRIORITIES, type Issue, type IssueType, type Memory, type WriteAction } from "../beads/model.ts";
import { failureText, send, useTab, type Sheet } from "./bridge.ts";
import { PRIORITY_WORDS, Spinner, TYPE_WORDS, TypeBadge } from "./icons.tsx";
import { MarkdownText } from "./markdown.tsx";

/** A sheet over the tab with its fields, the bd command it will run, and its buttons; Escape cancels. */
function SheetFrame({ title, children, command, footer }: { title: string; children?: ReactNode; command: WriteAction | null; footer: ReactNode }) {
  const tab = useTab();
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === "Escape" && tab.showSheet(null);
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, []);
  return (
    <div className="sheet-backdrop" onPointerDown={(event) => event.target === event.currentTarget && tab.showSheet(null)}>
      <div className="sheet" role="dialog" aria-modal aria-label={title}>
        <h2>{title}</h2>
        {children}
        {command && (
          <pre className="command" data-hint="What it runs, with your bd">
            {shellText(writeArgs(command))}
          </pre>
        )}
        <div className="sheet-buttons">{footer}</div>
      </div>
    </div>
  );
}

/** Runs the sheet's write once the user confirms; the sheet stays, with bd's words, when bd refuses it. */
function useWrite(done: string) {
  const tab = useTab();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (action: WriteAction, after?: (reply: unknown) => void) => {
    setBusy(true);
    setProblem(null);
    try {
      const reply = (await send(action)) as { undo?: unknown };
      tab.showSheet(null);
      tab.toast(done, { undo: (reply?.undo as never) ?? null });
      after?.(reply);
    } catch (error) {
      setProblem(failureText(error));
    } finally {
      setBusy(false);
    }
  };
  return { busy, problem, run };
}

function Buttons({ busy, problem, confirm, disabled = false, danger = false, onConfirm }: { busy: boolean; problem: string | null; confirm: string; disabled?: boolean; danger?: boolean; onConfirm(): void }) {
  const tab = useTab();
  return (
    <>
      {problem && <p className="sheet-problem">⚠ {problem}</p>}
      <span className="spacer" />
      <button type="button" className="button" onClick={() => tab.showSheet(null)}>
        Cancel
      </button>
      <button type="button" className={`button ${danger ? "danger-fill" : "primary"}`} disabled={busy || disabled} onClick={onConfirm}>
        {busy && <Spinner />} {confirm}
      </button>
    </>
  );
}

/** A Markdown box with Write and Preview; ⌘↵ confirms. */
function WriteBox({ value, onChange, label, placeholder, onSubmit, rows = 6 }: { value: string; onChange(value: string): void; label: string; placeholder: string; onSubmit?(): void; rows?: number }) {
  const [preview, setPreview] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);
  return (
    <div className="write-box">
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
          <MarkdownText text={value} empty="Nothing to preview." />
        </div>
      ) : (
        <textarea ref={box} rows={rows} aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => (event.metaKey || event.ctrlKey) && event.key === "Enter" && onSubmit?.()} />
      )}
    </div>
  );
}

const named = (issue: Issue) => `${issue.id} (${issue.title})`;

function CloseSheet({ issue }: { issue: Issue }) {
  const tab = useTab();
  const [reason, setReason] = useState("");
  const write = useWrite(`Closed ${issue.id}`);
  const action = { kind: "close", id: issue.id, reason } as const;
  const openChildren = (tab.graph.children.get(issue.id) ?? []).filter((child) => !isClosed(child));
  const waiting = tab.graph.blocking.get(issue.id)?.filter((other) => !isClosed(other)) ?? [];
  return (
    <SheetFrame title={`Close ${issue.id}?`} command={action} footer={<Buttons {...write} confirm="Close it" disabled={openChildren.length > 0} onConfirm={() => write.run(action)} />}>
      <p className="sheet-about">{issue.title}</p>
      <input className="wide-input" aria-label="Why" placeholder="Why, in a few words (optional): done in 3f2a1c, won't do…" value={reason} onChange={(event) => setReason(event.target.value)} autoFocus onKeyDown={(event) => event.key === "Enter" && openChildren.length === 0 && write.run(action)} />
      {openChildren.length > 0 && <p className="warn">⚠ {openChildren.length === 1 ? "1 child is" : `${openChildren.length} children are`} still open. bd closes a parent only once its children are closed.</p>}
      {waiting.length > 0 && <p className="muted">Closing it lets {waiting.length === 1 ? named(waiting[0]!) : `${waiting.length} issues`} go ahead.</p>}
    </SheetFrame>
  );
}

const DEFER_CHOICES = [
  ["tomorrow", "Tomorrow"],
  ["next monday", "Next Monday"],
  ["+2w", "In two weeks"],
  ["+1m", "In a month"],
] as const;

type DeferMode = (typeof DEFER_CHOICES)[number][0] | "date" | "indefinitely";

function DeferSheet({ issue }: { issue: Issue }) {
  const [mode, setMode] = useState<DeferMode>("next monday");
  const [date, setDate] = useState("");
  const until = mode === "date" ? date : mode === "indefinitely" ? "" : mode;
  const write = useWrite(`Deferred ${issue.id}`);
  const action = { kind: "defer", id: issue.id, until } as const;
  return (
    <SheetFrame title={`Defer ${issue.id}?`} command={action} footer={<Buttons {...write} confirm="Defer it" disabled={mode === "date" && !date} onConfirm={() => write.run(action)} />}>
      <p className="sheet-about">{issue.title}</p>
      <p className="muted">It leaves the ready work until then, and comes back to open by itself.</p>
      <div className="choices" role="radiogroup" aria-label="Until">
        {DEFER_CHOICES.map(([value, words]) => (
          <label key={value}>
            <input type="radio" name="until" checked={mode === value} onChange={() => setMode(value)} /> <b>{words}</b>
          </label>
        ))}
        <label>
          <input type="radio" name="until" checked={mode === "date"} onChange={() => setMode("date")} /> <b>A date</b>
          <input type="date" aria-label="Date" value={date} onChange={(event) => (setDate(event.target.value), setMode("date"))} />
        </label>
        <label>
          <input type="radio" name="until" checked={mode === "indefinitely"} onChange={() => setMode("indefinitely")} /> <b>Until I bring it back</b>
        </label>
      </div>
    </SheetFrame>
  );
}

function CreateSheet({ parent }: { parent: Issue | null }) {
  const tab = useTab();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<IssueType>("task");
  const [priority, setPriority] = useState(parent?.priority ?? 2);
  const [under, setUnder] = useState<string>(parent?.id ?? tab.prefs.nowFilter.epic ?? "");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState("");
  const write = useWrite("Created it");
  const parents = tab.graph.issues.filter((issue) => !isClosed(issue) && (issue.type === "epic" || issue.id === parent?.id));
  const action = { kind: "create", title, type, priority, parent: under || null, description, labels: labels.split(",").map((label) => label.trim()).filter(Boolean) } as const;
  const create = () =>
    title.trim() &&
    write.run(action, (reply) => {
      const id = (reply as { id?: string }).id;
      if (id) setTimeout(() => tab.select(id), 400);
    });
  return (
    <SheetFrame title={parent ? `New issue under ${parent.id}` : "New issue"} command={title.trim() ? action : null} footer={<Buttons {...write} confirm="Create it" disabled={!title.trim()} onConfirm={create} />}>
      <input className="wide-input title-input" aria-label="Title" placeholder="Title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus onKeyDown={(event) => event.key === "Enter" && create()} />
      <div className="field-row">
        <label>
          Type
          <select value={type} onChange={(event) => setType(event.target.value)}>
            {Object.entries(TYPE_WORDS).map(([value, words]) => (
              <option key={value} value={value}>
                {words}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={priority} onChange={(event) => setPriority(Number(event.target.value))}>
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_WORDS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Under
          <select value={under} onChange={(event) => setUnder(event.target.value)}>
            <option value="">No parent</option>
            {parents.map((issue) => (
              <option key={issue.id} value={issue.id}>
                {issue.title} · {issue.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input className="wide-input" aria-label="Labels" placeholder="Labels, separated by commas (optional)" value={labels} onChange={(event) => setLabels(event.target.value)} />
      <WriteBox value={description} onChange={setDescription} label="Description" placeholder="Description, in Markdown (optional)" onSubmit={create} rows={5} />
    </SheetFrame>
  );
}

const FIELD_TITLES = { title: "Rename", description: "Description of", design: "Design of", acceptance: "Acceptance criteria of", notes: "Notes of" } as const;

function EditSheet({ issue, field, value }: { issue: Issue; field: keyof typeof FIELD_TITLES; value: string }) {
  const [text, setText] = useState(value);
  const write = useWrite("Saved");
  const action = { kind: "edit", id: issue.id, field, value: text } as const;
  const save = () => text !== value && (field !== "title" || text.trim()) && write.run(action);
  return (
    <SheetFrame title={`${FIELD_TITLES[field]} ${issue.id}`} command={text !== value ? action : null} footer={<Buttons {...write} confirm="Save" disabled={text === value || (field === "title" && !text.trim())} onConfirm={save} />}>
      {field === "title" ? (
        <input className="wide-input title-input" aria-label="Title" value={text} onChange={(event) => setText(event.target.value)} autoFocus onKeyDown={(event) => event.key === "Enter" && save()} />
      ) : (
        <>
          <p className="sheet-about">{issue.title}</p>
          <WriteBox value={text} onChange={setText} label={FIELD_TITLES[field]} placeholder="In Markdown" onSubmit={save} rows={12} />
        </>
      )}
    </SheetFrame>
  );
}

function NoteSheet({ issue }: { issue: Issue }) {
  const tab = useTab();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const done = await tab.edit({ kind: "append-note", id: issue.id, text: text.trim() }, `Added a note to ${issue.id}`);
    setBusy(false);
    if (done) tab.showSheet(null);
  };
  return (
    <SheetFrame title={`Add a note to ${issue.id}`} command={text.trim() ? { kind: "append-note", id: issue.id, text: text.trim() } : null} footer={<Buttons busy={busy} problem={null} confirm="Add note" disabled={!text.trim()} onConfirm={() => void add()} />}>
      <p className="sheet-about">{issue.title}</p>
      <WriteBox value={text} onChange={setText} label="Note" placeholder="Goes at the end of its notes: what you found, decided or did" onSubmit={() => void add()} rows={4} />
    </SheetFrame>
  );
}

const LINK_KINDS = [
  ["blocks", "It waits for", "This can't start until the other is closed."],
  ["related", "Related to", "Worth reading together; neither waits."],
  ["discovered-from", "Found while working on", "Came up during the other."],
] as const;

function LinkSheet({ issue }: { issue: Issue }) {
  const tab = useTab();
  const [kind, setKind] = useState<string>("blocks");
  const [query, setQuery] = useState("");
  const [on, setOn] = useState<Issue | null>(null);
  const write = useWrite(`Linked ${issue.id}`);
  const matches = query.trim() ? tab.graph.issues.filter((other) => other.id !== issue.id && titleMatches(other, query)).slice(0, 8) : [];
  const action = on ? ({ kind: "link", id: issue.id, on: on.id, type: kind } as const) : null;
  return (
    <SheetFrame title={`Link ${issue.id} to another issue`} command={action} footer={<Buttons {...write} confirm="Link them" disabled={!action} onConfirm={() => action && write.run(action)} />}>
      <p className="sheet-about">{issue.title}</p>
      <div className="choices" role="radiogroup" aria-label="How">
        {LINK_KINDS.map(([value, words, about]) => (
          <label key={value}>
            <input type="radio" name="kind" checked={kind === value} onChange={() => setKind(value)} /> <b>{words}</b> <span className="muted">{about}</span>
          </label>
        ))}
      </div>
      {on ? (
        <div className="picked-issue">
          <TypeBadge type={on.type} /> {on.title} <span className="id">{on.id}</span>
          <button type="button" className="link" onClick={() => setOn(null)}>
            Change
          </button>
        </div>
      ) : (
        <>
          <input className="wide-input" aria-label="Find the other issue" placeholder="Find the other issue by its title or id" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
          <div className="issue-picks">
            {matches.map((other) => (
              <button key={other.id} type="button" onClick={() => setOn(other)}>
                <TypeBadge type={other.type} /> {other.title} <span className="id">{other.id}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </SheetFrame>
  );
}

function MemorySheet({ memory }: { memory: Memory | null }) {
  const [key, setKey] = useState(memory?.key ?? "");
  const [text, setText] = useState(memory?.text ?? "");
  const write = useWrite(memory ? "Saved the memory" : "Remembered");
  const cleanKey = key.trim().toLowerCase().replace(/\s+/g, "-");
  const action = { kind: "remember", key: cleanKey, text } as const;
  const ready = !!cleanKey && !!text.trim() && text !== memory?.text;
  return (
    <SheetFrame title={memory ? `Edit the memory ${memory.key}` : "Remember something"} command={ready ? action : null} footer={<Buttons {...write} confirm={memory ? "Save" : "Remember"} disabled={!ready} onConfirm={() => write.run(action)} />}>
      {!memory && <input className="wide-input" aria-label="Key" placeholder="A short key, like release-steps" value={key} onChange={(event) => setKey(event.target.value)} autoFocus />}
      <WriteBox value={text} onChange={setText} label="Memory" placeholder="What the project should keep knowing: a step, a trap, a decision" onSubmit={() => ready && write.run(action)} rows={6} />
      <p className="muted small">Agents read memories with bd prime at the start of each session.</p>
    </SheetFrame>
  );
}

function ForgetSheet({ memory }: { memory: Memory }) {
  const write = useWrite(`Forgot ${memory.key}`);
  const action = { kind: "forget", key: memory.key } as const;
  return (
    <SheetFrame title={`Forget ${memory.key}?`} command={action} footer={<Buttons {...write} confirm="Forget it" danger onConfirm={() => write.run(action)} />}>
      <p className="sheet-about">{memory.text}</p>
      <p className="muted">Agents stop seeing it. Undo in the message after brings it back.</p>
    </SheetFrame>
  );
}

export function SheetView({ sheet }: { sheet: Sheet }) {
  switch (sheet.kind) {
    case "close":
      return <CloseSheet issue={sheet.issue} />;
    case "defer":
      return <DeferSheet issue={sheet.issue} />;
    case "create":
      return <CreateSheet parent={sheet.parent} />;
    case "edit":
      return <EditSheet issue={sheet.issue} field={sheet.field} value={sheet.value} />;
    case "note":
      return <NoteSheet issue={sheet.issue} />;
    case "link":
      return <LinkSheet issue={sheet.issue} />;
    case "memory":
      return <MemorySheet memory={sheet.memory} />;
    case "forget":
      return <ForgetSheet memory={sheet.memory} />;
  }
}
