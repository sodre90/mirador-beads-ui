import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { helpers, startHostWithThisPlugin, type TestHost } from "./mirador.ts";

let host: TestHost;
let promptsFile: string;
let bd: (...args: string[]) => string;
const agentSaw = () => readFileSync(promptsFile, "utf8");
const shown = (id: string) => JSON.parse(bd("show", id, "--json"))[0] as { status: string; priority: number; assignee?: string };
const memoryKeys = () => Object.keys(JSON.parse(bd("memories", "--json")) as Record<string, string>);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  ({ host, promptsFile, bd } = await startHostWithThisPlugin());
});
test.afterAll(async () => {
  await host?.stop();
  await host?.cleanUp();
});

const tab = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-frame.workspace-tab iframe");
const sheet = (page: Page) => tab(page).getByRole("dialog");
const toast = (page: Page) => tab(page).locator(".toast");
const view = (page: Page, name: string) => tab(page).locator(".views").getByRole("tab", { name: new RegExp(`^${name}`) });
const column = (page: Page, name: string) => tab(page).getByRole("region", { name });
const card = (page: Page, id: string) => tab(page).locator(`.card[data-id="${id}"]`);
const row = (page: Page, id: string) => tab(page).locator(`.row[data-id="${id}"]`);
const detail = (page: Page) => tab(page).locator(".detail");
/** With BEADS_SCREENSHOTS naming a folder, the canvas pane as the step leaves it, for the README and for a look. */
const shoot = async (page: Page, name: string) => {
  const folder = process.env.BEADS_SCREENSHOTS;
  if (folder) await page.locator(".canvas-panel:visible").screenshot({ path: join(folder, `${name}.png`) });
};

async function openConversation(page: Page) {
  const { addWorkspace, createProfile, signIn } = helpers();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "beads", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "beads · opencode" });
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
}

test("a workspace connects to its beads, and its epics, issues and memories are found, read and changed", async ({ page }) => {
  await openConversation(page);

  await test.step("the tab finds the database bd sees in the folder and connects once the user confirms", async () => {
    await page.locator(".canvas-panel:visible .workspace-tab-toggle", { hasText: "Beads" }).click();
    await expect(tab(page).getByRole("heading", { name: "Connect this workspace to its beads" })).toBeVisible();
    await expect(tab(page).locator(".found")).toContainText("kt");
    await tab(page).getByRole("button", { name: "Connect" }).click();
    await expect(card(page, "kt-off.2")).toBeVisible();
  });

  await test.step("the Now board shows what's in progress, what's ready and what waits", async () => {
    await expect(column(page, "In progress").locator(".card")).toHaveCount(1);
    await expect(column(page, "In progress")).toContainText("Queue edits made offline and replay them");
    await expect(column(page, "Ready")).toContainText("Notes vanish after renaming a folder");
    await expect(column(page, "Ready")).toContainText("Show a banner while offline");
    await expect(column(page, "Ready")).not.toContainText("Resolve conflicts");
    await expect(column(page, "Blocked")).toContainText("Resolve conflicts when two devices edit one note");
    await shoot(page, "now");
  });

  await test.step("claiming a ready card moves it to In progress at once, and Undo puts it back", async () => {
    await card(page, "kt-7").hover();
    await card(page, "kt-7").getByRole("button", { name: "Claim" }).click();
    await expect(column(page, "In progress").locator('.card[data-id="kt-7"]')).toBeVisible();
    expect(shown("kt-7")).toMatchObject({ status: "in_progress", assignee: "dana" });
    await expect(toast(page)).toContainText("Claimed kt-7 (Notes vanish after renaming a folder)");
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect(column(page, "Ready").locator('.card[data-id="kt-7"]')).toBeVisible();
    expect(shown("kt-7").status).toBe("open");
    expect(shown("kt-7").assignee ?? "").toBe("");
  });

  await test.step("dragging a ready card onto In progress claims it too", async () => {
    await card(page, "kt-off.4").dragTo(column(page, "In progress"));
    await expect(column(page, "In progress").locator('.card[data-id="kt-off.4"]')).toBeVisible();
    await expect.poll(() => shown("kt-off.4").status).toBe("in_progress");
  });

  await test.step("an epic shows its progress and the tree of its work", async () => {
    await view(page, "Epics").click();
    const epic = tab(page).getByRole("region", { name: "Offline mode: notes work without a connection" });
    await expect(epic.getByRole("img", { name: "1 of 4 done" })).toBeVisible();
    await epic.getByRole("button", { name: /^Unfold/ }).click();
    await expect(epic.locator(".tree-row")).toHaveCount(3);
    await epic.getByRole("button", { name: "Show 1 done" }).click();
    await expect(epic.locator(".tree-row")).toHaveCount(4);
    await expect(epic.locator(".tree-row.s-closed")).toContainText("Keep a local copy of every note");
    await shoot(page, "epics");
  });

  await test.step("the search reads long texts too, and the issue opens beside the list", async () => {
    await view(page, "Issues").click();
    await tab(page).getByLabel("Search").fill("IndexedDB");
    await expect(row(page, "kt-off.2")).toBeVisible();
    await expect(row(page, "kt-7")).toHaveCount(0);
    await expect(row(page, "kt-off.2").locator(".snippet")).toContainText("IndexedDB");
    await row(page, "kt-off.2").click();
    await expect(detail(page).locator(".detail-title")).toHaveText("Queue edits made offline and replay them");
    await expect(detail(page)).toContainText("Every edit goes into a queue first.");
    await shoot(page, "issues");
    await tab(page).getByLabel("Search").fill("");
  });

  await test.step("a field changes from its picker, with Undo", async () => {
    await detail(page).getByRole("button", { name: /^Priority/ }).click();
    await detail(page).getByRole("option", { name: "P0 · critical" }).click();
    await expect(detail(page).locator(".fields .priority")).toHaveText("P0");
    expect(shown("kt-off.2").priority).toBe(0);
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expect(detail(page).locator(".fields .priority")).toHaveText("P1");
    expect(shown("kt-off.2").priority).toBe(1);
  });

  await test.step("the dependencies and the activity with its comments show, and a comment posts", async () => {
    await detail(page).locator(".sections").getByRole("tab", { name: /^Dependencies/ }).click();
    await expect(detail(page).locator(".dependencies")).toContainText("Resolve conflicts when two devices edit one note");
    await detail(page).locator(".sections").getByRole("tab", { name: /^Activity/ }).click();
    await expect(detail(page).locator(".timeline")).toContainText("Replay order matters for renames.");
    await tab(page).locator("#comment-text").fill("Renames replay **before** edits.");
    await detail(page).locator(".comment-buttons").getByRole("button", { name: "Comment" }).click();
    await expect(detail(page).locator(".timeline")).toContainText("Renames replay before edits.");
    await shoot(page, "activity-of-issue");
    expect((JSON.parse(bd("comments", "kt-off.2", "--json")) as { text: string }[]).map((comment) => comment.text)).toContain("Renames replay **before** edits.");
  });

  await test.step("the agent gets the issue to work on", async () => {
    await detail(page).getByRole("button", { name: "More ways to hand it to the agent" }).click();
    await detail(page).getByRole("button", { name: /Send to this conversation/ }).click();
    await expect.poll(agentSaw).toContain("kt-off.2");
    await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
  });

  await test.step("closing asks why, shows the command, and closes it", async () => {
    await row(page, "kt-off.4").click();
    await detail(page).getByRole("button", { name: "Close…" }).click();
    await expect(sheet(page).locator(".command")).toContainText("close kt-off.4");
    await sheet(page).getByLabel("Why").fill("Banner shipped");
    await sheet(page).getByRole("button", { name: "Close it" }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => shown("kt-off.4").status).toBe("closed");
  });

  await test.step("a change made outside the tab shows up by itself", async () => {
    bd("create", "--id", "kt-12", "--title", "Export notes as Markdown", "--type", "feature", "--priority", "2");
    await expect(row(page, "kt-12")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("memories are listed, searched, added and forgotten", async () => {
    await tab(page).getByRole("button", { name: "Close the issue's panel" }).click();
    await expect(detail(page)).toHaveCount(0);
    await view(page, "Memories").click();
    await expect(tab(page).locator(".memory")).toHaveCount(2);
    await shoot(page, "memories");
    await tab(page).getByLabel("Search").fill("replays");
    await expect(tab(page).locator(".memory")).toHaveCount(1);
    await expect(tab(page).locator(".memory mark")).toHaveText("replays");
    await tab(page).getByLabel("Search").fill("");
    await tab(page).getByRole("button", { name: "+ Remember" }).click();
    await sheet(page).getByLabel("Key").fill("export-format");
    await sheet(page).getByLabel("Memory").fill("Exports keep the front matter.");
    await sheet(page).getByRole("button", { name: "Remember" }).click();
    await expect(tab(page).locator('.memory[data-key="export-format"]')).toBeVisible();
    expect(memoryKeys()).toContain("export-format");
    await tab(page).locator('.memory[data-key="export-format"]').getByRole("button", { name: "Forget…" }).click();
    await sheet(page).getByRole("button", { name: "Forget it" }).click();
    await expect(tab(page).locator('.memory[data-key="export-format"]')).toHaveCount(0);
    expect(memoryKeys()).not.toContain("export-format");
  });

  await test.step("the activity feed tells what happened, by whom", async () => {
    await view(page, "Activity").click();
    const feed = tab(page).locator(".activity");
    await expect(feed).toContainText("Export notes as Markdown");
    await expect(feed).toContainText("Show a banner while offline");
    await expect(feed.locator(".activity-what b").first()).toHaveText(/dana/);
    await shoot(page, "activity");
  });
});
