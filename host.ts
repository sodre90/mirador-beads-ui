import type { CanvasHost } from "./mirador/api.ts";
import { BeadsTab } from "./beads/tab.ts";

/** The workspace's beads database in a tab of its canvas: what's in progress and ready, epics, issues and memories, through bd. */
const host: CanvasHost = { items: {}, tools: {}, workspaceTab: new BeadsTab() };

export default host;
