import { useState } from "react";
import type { BdProblem, TabState } from "../beads/model.ts";
import { failureText, send } from "./bridge.ts";
import { Spinner } from "./icons.tsx";

/** The workspace isn't connected yet: the database bd finds in its folder, to confirm. */
export function Connect({ state }: { state: TabState }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const candidate = state.candidate;
  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await send({ kind: "connect" });
    } catch (error) {
      setProblem(failureText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="center">
      <div className="panel connect">
        <h2>Connect this workspace to its beads</h2>
        {candidate ? (
          <div className="found">
            <span className="found-mark">●●●</span>
            <div>
              <b>{candidate.prefix}</b> · {candidate.issues} issues
              <div className="muted small">{candidate.beadsDir}</div>
            </div>
          </div>
        ) : (
          <p className="muted">bd finds no beads database in this workspace's folder. Run bd init there, then try again.</p>
        )}
        {problem && <p className="sheet-problem">⚠ {problem}</p>}
        <div className="sheet-buttons">
          <span className="spacer" />
          <button type="button" className="button primary" disabled={!candidate || busy} onClick={() => void connect()}>
            {busy && <Spinner />} Connect
          </button>
        </div>
        <p className="muted small">The tab reads and writes with the bd on this computer, as your agents do. Small edits happen at once, with Undo.</p>
      </div>
    </div>
  );
}

const copy = (text: string) => void navigator.clipboard?.writeText(text);

/** bd can't answer: what's wrong, and how to put it right. */
export function Problem({ problem, onRetry }: { problem: BdProblem; onRetry(): void }) {
  const command = problem.code === "not-installed" ? "brew install beads" : problem.code === "no-database" ? "bd init" : null;
  const title = problem.code === "not-installed" ? "bd isn't installed" : problem.code === "no-database" ? "There's no beads database here" : "bd couldn't read the database";
  return (
    <div className="center">
      <div className="panel problem">
        <h2>{title}</h2>
        {command ? (
          <>
            <p className="muted">Run this in a terminal {problem.code === "no-database" ? "in the workspace's folder" : "on this computer"}, then try again:</p>
            <pre className="command">{command}</pre>
          </>
        ) : (
          <p className="muted">{problem.message}</p>
        )}
        <div className="sheet-buttons">
          <span className="spacer" />
          {command && (
            <button type="button" className="button" onClick={() => copy(command)}>
              Copy
            </button>
          )}
          <button type="button" className="button primary" onClick={onRetry}>
            Try again
          </button>
        </div>
        {problem.code === "not-installed" && <p className="muted small">On Linux and Windows, see github.com/gastownhall/beads for other ways to install it.</p>}
      </div>
    </div>
  );
}
