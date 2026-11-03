import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Graph } from "../beads/derive.ts";
import { DEFAULT_PREFS, VIEWS, type Issue, type Prefs, type SearchReply, type TabState, type Undo, type View, type WriteAction, type WriteReply } from "../beads/model.ts";
import { ActivityView } from "./activity.tsx";
import { failureText, send, TabContext, type Sheet, type Tab } from "./bridge.ts";
import { Connect, Problem } from "./connect.tsx";
import { Detail } from "./detail.tsx";
import { EpicsView } from "./epics.tsx";
import { Spinner } from "./icons.tsx";
import { IssuesView } from "./issues.tsx";
import { MemoriesView } from "./memories.tsx";
import { NowView } from "./now.tsx";
import { SheetView } from "./sheets.tsx";
import { TopBar } from "./top.tsx";
import viewStyles from "./view.css" with { type: "text" };

const POLL_EVERY_MS = 3000;
const NARROW_PX = 720;
const TOAST_MS = 5000;

function useTabState() {
  const [state, setState] = useState<TabState | null>(null);
  useEffect(() => window.mirador.onState(setState), []);
  return state;
}

function useNarrow(root: React.RefObject<HTMLElement | null>) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? NARROW_PX) < NARROW_PX));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [root.current]);
  return narrow;
}

/** While the page shows, the host is asked every few seconds whether the database changed; it reads only when it did. */
function usePolling(connected: boolean) {
  useEffect(() => {
    if (!connected) return;
    const poll = () => document.visibilityState === "visible" && void send({ kind: "poll" }).catch(() => {});
    poll();
    const timer = setInterval(poll, POLL_EVERY_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [connected]);
}

/** The long texts the host searched for the query, a moment after the user stops typing. */
function useHostSearch(query: string, connected: boolean, loadedAt: number | null) {
  const [found, setFound] = useState<SearchReply | null>(null);
  useEffect(() => {
    if (!connected || !query.trim()) return setFound(null);
    let current = true;
    void send({ kind: "search", text: query }).then(
      (reply) => current && setFound(reply as SearchReply),
      () => current && setFound(null),
    );
    return () => void (current = false);
  }, [query, connected, loadedAt]);
  return found;
}

type Toast = { text: string; failed: boolean; undo: Undo | null };

function ToastView({ toast, onUndo }: { toast: Toast | null; onUndo(undo: Undo): void }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.failed ? "failed" : ""}`} role="status">
      <span>{toast.text}</span>
      {toast.undo && (
        <button type="button" className="undo" onClick={() => onUndo(toast.undo!)}>
          Undo
        </button>
      )}
    </div>
  );
}

const VIEW_KEYS: Record<string, View> = Object.fromEntries(VIEWS.map((view, index) => [String(index + 1), view]));

function useKeys(tab: Tab | null, sheetOpen: boolean) {
  useEffect(() => {
    if (!tab) return;
    const pressed = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (sheetOpen || event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [role=dialog]")) return;
      const rows = [...document.querySelectorAll<HTMLElement>("[data-id]")].map((element) => element.dataset.id!);
      const at = tab.selected ? rows.indexOf(tab.selected.id) : -1;
      const move = (by: number) => {
        const next = rows[Math.min(rows.length - 1, Math.max(0, at + by))];
        if (!next) return;
        tab.select(next);
        requestAnimationFrame(() => document.querySelector(`[data-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" }));
      };
      const selected = tab.selected;
      const actions: Record<string, () => void> = {
        j: () => move(1),
        ArrowDown: () => move(1),
        k: () => move(-1),
        ArrowUp: () => move(-1),
        "/": () => document.getElementById("beads-search")?.focus(),
        r: tab.refresh,
        n: () => tab.showSheet(tab.view === "memories" ? { kind: "memory", memory: null } : { kind: "create", parent: selected?.type === "epic" ? selected : null }),
        Escape: () => tab.select(null),
        ...Object.fromEntries(Object.entries(VIEW_KEYS).map(([key, view]) => [key, () => tab.setView(view)])),
        ...(selected && {
          w: () => document.getElementById("work-on-this")?.click(),
          x: () => selected.status !== "closed" && tab.showSheet({ kind: "close", issue: selected }),
          c: () => document.getElementById("comment-text")?.focus(),
        }),
      };
      const act = actions[event.key];
      if (!act) return;
      event.preventDefault();
      act();
    };
    addEventListener("keydown", pressed);
    return () => removeEventListener("keydown", pressed);
  }, [tab, sheetOpen]);
}

function App() {
  const state = useTabState();
  const root = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(root);
  const [prefsHere, setPrefsHere] = useState<Prefs | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const connected = !!state?.connection;
  usePolling(connected);
  const found = useHostSearch(query, connected, state?.loadedAt ?? null);
  const prefs = prefsHere ?? state?.prefs ?? DEFAULT_PREFS;
  const graph = useMemo(() => new Graph(state?.issues ?? []), [state?.issues]);
  const selected = selectedId ? (graph.byId.get(selectedId) ?? null) : null;

  const showToast = useCallback((text: string, options: { failed?: boolean; undo?: Undo | null } = {}) => {
    clearTimeout(toastTimer.current);
    setToast({ text, failed: options.failed ?? false, undo: options.undo ?? null });
    toastTimer.current = setTimeout(() => setToast(null), options.undo ? TOAST_MS * 2 : TOAST_MS);
  }, []);

  const tab = useMemo<Tab | null>(() => {
    if (!state?.connection || !state.issues) return null;
    const setPrefs = (next: Prefs) => {
      setPrefsHere(next);
      void send({ kind: "prefs", prefs: next }).catch(() => {});
    };
    return {
      state,
      graph,
      prefs,
      setPrefs,
      view: prefs.view,
      setView: (view) => setPrefs({ ...prefs, view }),
      query,
      setQuery,
      found,
      selected,
      select(issue: Issue | string | null) {
        const id = typeof issue === "string" ? issue : (issue?.id ?? null);
        setSelectedId(id);
        if (id) void send({ kind: "open", id }).catch(() => {});
      },
      showSheet: setSheet,
      async edit(action: WriteAction, done: string) {
        try {
          const reply = (await send(action)) as WriteReply;
          showToast(done, { undo: reply.undo });
          return reply;
        } catch (error) {
          showToast(failureText(error), { failed: true });
          return null;
        }
      },
      toast: showToast,
      refresh: () => void send({ kind: "refresh" }).catch((error) => showToast(failureText(error), { failed: true })),
      narrow,
    };
  }, [state, graph, prefs, query, found, selected, narrow]);

  useKeys(tab, sheet !== null);

  const undo = (what: Undo) =>
    void send({ kind: "undo", undo: what }).then(
      () => showToast("Undone"),
      (error) => showToast(failureText(error), { failed: true }),
    );

  const besideList = prefs.view === "issues" && !narrow;
  return (
    <div className={`app ${narrow ? "narrow" : "wide"}`} ref={root}>
      {!state && (
        <div className="center">
          <Spinner />
        </div>
      )}
      {state && !state.connection && (state.problem ? <Problem problem={state.problem} onRetry={() => void send({ kind: "connect" }).catch(() => {})} /> : <Connect state={state} />)}
      {state?.connection && !state.issues && (state.problem ? <Problem problem={state.problem} onRetry={() => void send({ kind: "refresh" }).catch(() => {})} /> : (
        <div className="center">
          <Spinner /> Reading the database…
        </div>
      ))}
      {tab && (
        <TabContext.Provider value={tab}>
          <TopBar />
          <main className={`body view-${prefs.view} ${selected ? "has-detail" : ""} ${besideList ? "beside" : "over"}`}>
            <div className="content">
              {prefs.view === "now" && <NowView />}
              {prefs.view === "epics" && <EpicsView />}
              {prefs.view === "issues" && <IssuesView />}
              {prefs.view === "memories" && <MemoriesView />}
              {prefs.view === "activity" && <ActivityView />}
            </div>
            {selected && prefs.view !== "memories" && (
              <aside className="detail-pane">
                <Detail key={selected.id} issue={selected} />
              </aside>
            )}
          </main>
          {sheet && <SheetView sheet={sheet} />}
        </TabContext.Provider>
      )}
      <ToastView toast={toast} onUndo={undo} />
    </div>
  );
}

const style = document.createElement("style");
style.textContent = viewStyles;
document.head.append(style);
document.body.innerHTML = '<div id="root"></div>';
createRoot(document.getElementById("root")!).render(<App />);
