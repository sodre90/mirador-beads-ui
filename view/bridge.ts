import { createContext, useContext } from "react";
import type { Graph } from "../beads/derive.ts";
import type { Issue, Memory, Prefs, SearchReply, TabAction, TabState, Undo, View, WriteAction, WriteReply } from "../beads/model.ts";
import type { PluginViewBridge } from "../mirador/api.ts";

declare global {
  interface Window {
    mirador: PluginViewBridge<TabState>;
  }
}

export const send = (action: TabAction) => window.mirador.send(action);

/** A sheet over the tab: a write that asks first, or a form that ends in one. */
export type Sheet =
  | { kind: "close"; issue: Issue }
  | { kind: "defer"; issue: Issue }
  | { kind: "create"; parent: Issue | null }
  | { kind: "edit"; issue: Issue; field: "title" | "description" | "design" | "acceptance" | "notes"; value: string }
  | { kind: "note"; issue: Issue }
  | { kind: "link"; issue: Issue }
  | { kind: "memory"; memory: Memory | null }
  | { kind: "forget"; memory: Memory };

/** What every part of the tab reaches: the host's state, the graph over its issues, and the user's place in it. */
export interface Tab {
  state: TabState;
  graph: Graph;
  prefs: Prefs;
  setPrefs(prefs: Prefs): void;
  view: View;
  setView(view: View): void;
  query: string;
  setQuery(query: string): void;
  /** What the host found in the long texts for the query, beside the titles the view matches itself. */
  found: SearchReply | null;
  selected: Issue | null;
  select(issue: Issue | string | null): void;
  showSheet(sheet: Sheet | null): void;
  /** A small edit at once, with Undo in the toast; failures show there too. */
  edit(action: WriteAction, done: string): Promise<WriteReply | null>;
  toast(text: string, options?: { failed?: boolean; undo?: Undo | null }): void;
  refresh(): void;
  narrow: boolean;
}

export const TabContext = createContext<Tab | null>(null);

export function useTab(): Tab {
  const tab = useContext(TabContext);
  if (!tab) throw new Error("useTab outside the tab");
  return tab;
}

/** An action's failure, as its message: the host words them for the user. */
export const failureText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** An id with a few words of its title, as the user reads ids everywhere in the tab: never alone. */
export function idWithTitle(graph: Graph, id: string, words = 6) {
  const title = graph.byId.get(id)?.title;
  if (!title) return id;
  const short = title.split(/\s+/).slice(0, words).join(" ");
  return `${id} (${short}${short.length < title.length ? "…" : ""})`;
}
