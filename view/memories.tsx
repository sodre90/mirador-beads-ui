import { useState } from "react";
import { memoryGroupOf, memoryGroups, memoryMatches, memoryTitle } from "../beads/derive.ts";
import { memoryText } from "../beads/handoff.ts";
import type { Memory } from "../beads/model.ts";
import { failureText, useTab } from "./bridge.ts";

/** The text with each searched word marked. */
function Marked({ text, query }: { text: string; query: string }) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(pattern).map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))}
    </>
  );
}

function MemoryCard({ memory }: { memory: Memory }) {
  const tab = useTab();
  const [whole, setWhole] = useState(false);
  const long = memory.text.length > 260;
  return (
    <article className="memory" data-key={memory.key}>
      <span className="memory-key">{memory.key}</span>
      <h3>
        <Marked text={memoryTitle(memory.key)} query={tab.query} />
      </h3>
      <p className={whole || !long ? "" : "clamped"}>
        <Marked text={memory.text} query={tab.query} />
      </p>
      <footer>
        {long && (
          <button type="button" className="link" onClick={() => setWhole(!whole)}>
            {whole ? "Less" : "More"}
          </button>
        )}
        <button type="button" className="link" onClick={() => tab.showSheet({ kind: "memory", memory })}>
          Edit
        </button>
        <button
          type="button"
          className="link"
          data-hint="Adds it to what you're writing, for the agent to read"
          onClick={() => void window.mirador.addToComposer(memoryText(memory)).then(() => tab.toast("Added to the composer"), (error) => tab.toast(failureText(error), { failed: true }))}
        >
          Mention
        </button>
        <span className="spacer" />
        <button type="button" className="link danger" onClick={() => tab.showSheet({ kind: "forget", memory })}>
          Forget…
        </button>
      </footer>
    </article>
  );
}

export function MemoriesView() {
  const tab = useTab();
  const [group, setGroup] = useState<string | null>(null);
  const memories = tab.state.memories ?? [];
  const groups = memoryGroups(memories);
  const shown = memories.filter((memory) => (!group || memoryGroupOf(memory) === group) && memoryMatches(memory, tab.query));
  return (
    <div className="memories-view">
      <div className="filters">
        <button type="button" className={`chip ${group === null ? "set" : ""}`} onClick={() => setGroup(null)}>
          All <span className="count">{memories.length}</span>
        </button>
        {groups.slice(0, 14).map(({ name, count }) => (
          <button key={name} type="button" className={`chip ${group === name ? "set" : ""}`} onClick={() => setGroup(group === name ? null : name)}>
            {name} <span className="count">{count}</span>
          </button>
        ))}
      </div>
      {memories.length === 0 ? (
        <div className="empty">
          <p>No memories yet.</p>
          <p className="muted">What the project should keep knowing across sessions: how to release, a trap in the tests, a decision. Agents add them with bd remember; add one here with + Remember.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <p>No memory matches.</p>
        </div>
      ) : (
        <div className="memories">
          {shown.map((memory) => (
            <MemoryCard key={memory.key} memory={memory} />
          ))}
        </div>
      )}
    </div>
  );
}
