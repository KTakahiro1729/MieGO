# Module boundaries for parallel refactoring

Baseline: `main` commit `0fcfec229c3d6da4c10379d8490edbc4cc86e273`. This change is a file extraction, not a behavioral redesign.

## Ownership and interfaces

| Workstream | Primary files | Responsibility | Shared contracts |
| --- | --- | --- | --- |
| Board / UI | `public/board-renderer.mjs`, `public/board-preview.mjs`, `public/territory-view.mjs`, `public/illegal-moves.mjs` | Draw committed, provisional and replayed positions, legal-move markers and ownership overlay | `createBoardRenderer({canvas,getView,createOverlayCanvas?}).draw()` receives immutable view inputs; never commits game state |
| History / SGF | `public/history-panel.mjs`, `public/game-library.mjs`, `public/sgf.mjs`, `public/sgf-link.mjs` | Saved-game list, archive navigation, import/export and review link format | `createHistoryPanel({$,gameLibrary,storageError})` owns `selection`/`step`; exported UI commands do not replace live matches |
| AI / analysis | `public/ai-opponent.mjs`, `public/analysis-worker.mjs`, `src/katago/**`, `public/endgame.mjs`, `public/dead-stones.mjs` | Asynchronous analysis, AI turns, suggestions | Worker message kinds/IDs, committed-position checks remain compatible |
| Online / P2P | `public/p2p-transport.mjs`, `public/p2p-session.mjs`, `src/worker.mjs` | Signaling, reconnection, checkpoint reconciliation | Preserve wire messages, invitation links, role checks and revision behavior |
| Game rules / scoring | `public/core.mjs`, `public/gomoku.mjs`, `public/scoring-flow.mjs`, `public/mode-state.mjs` | Rules (Go and 五目並べ), scoring and state validation | Preserve snapshots, move legality, hash and scoring semantics |
| Sheets / controls | `public/appearance-settings.mjs`, `public/help-sheet.mjs`, `public/share-images.mjs`, `public/confirm-retap.mjs`, `public/clipboard.mjs` | 設定 sheet's board look and colour map, help sheet and ? popovers, share-sheet images, two-tap confirmation, clipboard with manual-copy fallback | Each `create*({$,...})` takes getters for the state it reads and callbacks for what it triggers; it owns its own controls and keeps no game state |
| Text | `public/texts.mjs` | Every user-facing string: UI labels, status lines, errors, help and AI prompts | Modules read `TEXT.*`; `public/index.html` is rendered from `src/index.template.html` by `scripts/build-html.mjs` |
| Integration owner | `public/app.mjs`, `src/index.template.html`, CI and integration tests | Wiring, mode switches, review-to-live transitions and public interface changes | Changes touching cross-team calls go through a small integration PR |

## Change coordination

1. Branch from the same updated `main` after this extraction PR has merged. Assign one owner per workstream; each stream edits its own files and associated tests.
2. Keep `public/app.mjs` integration-owned. Changes requiring shared wiring are proposed as interface additions, then landed by the integration owner after the module changes are reviewed.
3. Do not change on-disk record schema (`miego:game:v1:`), P2P messages, or share-link shape within structural refactoring PRs. Version migrations require a separate PR.
4. Prefer behavior tests over asserting source-file names or exact code strings. Existing regex-based UI tests should be migrated gradually as components get split.
5. Each PR runs `npm test`, `node --check` for changed JS, and manual checks for capture preview, replay/SGF, local save and restore, P2P reconnect, scoring and AI fallback.
6. Merge workstreams independently when their interfaces are unchanged; isolate contract changes to small integration PRs and rebase on latest `main`.

## Sweeping changes

A sweeping change rewrites many lines across many files without changing what the app does: moving wording into `texts.mjs`, renaming, reformatting, moving code between modules. Every branch open at the time conflicts with it, line by line (`4e5510b` took 8 conflicting files after the `texts.mjs` move in #47). So:

1. A sweeping change is a PR of its own, with no feature or fix in it.
2. Start it from the latest `main` and merge it within the hour: the longer it is open, the more branches it collides with.
3. Say in the PR title that it is sweeping (for example `Sweep: …`), so open branches know to take `main` right after it merges.
4. Open branches merge `main` straight after it lands, while the conflicts are still only about the moved lines.
5. A feature that needs a sweep lands the sweep first, then the feature on top of it.

## Scope of this extraction

`board-renderer.mjs` owns Canvas paint and its illegal-move cache. The parent supplies current state on every draw, so review frames cannot commit a provisional move. `history-panel.mjs` owns saved-list rendering, selected record/step and SGF file import/export; match resume/branch, WebRTC and game mutation remain coordinated in `app.mjs`. No page redesign, dependency change or game-rule changes are intended.
