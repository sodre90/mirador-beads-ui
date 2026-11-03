import type { Issue, Memory } from "./model.ts";

/** An id with its title, as an agent or the user reads it in a message. */
export const mentionText = (issue: Pick<Issue, "id" | "title">) => `${issue.id} (${issue.title})`;

/** What a conversation started on an issue gets as its first message. */
export function workText(issue: Issue, epic: Issue | null) {
  return [
    `Work on the beads issue ${mentionText(issue)}${epic && epic.id !== issue.id ? `, part of the epic ${mentionText(epic)}` : ""}.`,
    "",
    `Read it with \`bd show ${issue.id}\`, claim it with \`bd update ${issue.id} --claim\` before you start, and close it with \`bd close ${issue.id}\` once it's done.`,
  ].join("\n");
}

/** For an epic: plan it rather than do it all at once. */
export function planText(epic: Issue, ready: Issue[]) {
  const next = ready.slice(0, 5).map((issue) => `- ${mentionText(issue)}`);
  return [
    `Look at the beads epic ${mentionText(epic)} with \`bd show ${epic.id}\` and \`bd children ${epic.id}\`, and tell me where it stands and what to do next.`,
    ...(next.length > 0 ? ["", "Ready now:", ...next] : []),
  ].join("\n");
}

export const memoryText = (memory: Memory) => `The project's beads memory "${memory.key}": ${memory.text}`;
