# Beads for Mirador

A Mirador workspace-tab plugin (plugin API 7). See README.md for what it does and how to run it.

- Bun and TypeScript everywhere, strict; imports carry their `.ts`/`.tsx` extensions. React 19 for the view.
- `bun run typecheck`, `bun run test` (not a bare `bun test`, which would pick up the Playwright specs) and `scripts/e2e.sh` before every commit. The e2e uses Mirador's Playwright, which runs on Node: no Bun APIs in `e2e/`. It runs the real `bd` on a database it seeds in a temp folder.
- `beads/` is pure apart from `tab.ts`; `host.ts` hands Mirador the tab; `view/` draws it in Mirador's sandboxed frame and talks to the host only through `window.mirador`. The sandbox has no `allow-forms`: no `<form>` submits there, so buttons and Enter keys act themselves.
- The tab's `shows` must stay cheap (no bd call) and `state` returns what's cached. One `bd list` read holds the light fields of every issue; long texts come with an opened issue's detail, and the host searches them.
- Reads are single-flight per workspace with a minimum gap: hidden frames of kept conversations poll too, and bd locks the embedded database while it reads. The change signal is a hash of the Dolt manifest.
- Every write goes through `writeArgs` in `beads/bd.ts`, so the command a sheet previews is the one that runs. Each write returns its Undo; an Undo guards against a change made since (bd's `--if-status`/`--if-assignee`, or the host comparing).
- `tests/fake-bd.ts` must behave like the real bd: check a command against `bd` itself before relying on it (bd adds a comment without touching `updated_at`, for one).
- Fixtures and the e2e database are made up (Kite, a note-taking app). Never copy a real project's issues, memories or names into this repo.
- Names over comments: keep comments for a genuine "why" that a name can't carry.
- Every change comes with tests: logic gets unit tests, and what the user sees gets e2e coverage.
- Words the user or the agent reads: plain words and sentence case. An issue id shown to the user carries its title.
- Commits: authored by the owner only, with no AI attribution or trailers. One plain sentence saying what the user gets.
- Releases: bump `version` in `plugin.json` and tag the commit `v<version>`; Mirador refuses a tag that doesn't match.
