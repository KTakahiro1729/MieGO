# MieGO

Many branches are worked on in parallel and merge into `main` within hours. `main` is the development branch; production (miego.fun) deploys only from `release`, which moves only by merging `main` into it (see "開発用とリリース用のブランチ" in `README.md`). Open feature and fix PRs against `main`, and 棋風診断 PRs against `feature/play-style`; never against `release`. Keep changes from colliding:

- **Sweeping changes go alone.** A wording move, rename, reformat or code move across many files is its own PR, started from the latest `main`, titled `Sweep: …`, with no feature or fix in it, and merged quickly. See "Sweeping changes" in `docs/MODULE_BOUNDARIES.md`.
- **New per-game options** (like board size or 石を隠す) go into `nextGameOptions()` in `public/app.mjs`, not into each `newGame()` call. Lists that branches add to (remembered settings, the renderer's `getView`, imports of more than three names) hold one item per line, in alphabetical order.
- **`public/index.html` is generated** and not tracked: edit `src/index.template.html` and wording in `public/texts.mjs`; `npm test` renders it.
- Module ownership: `docs/MODULE_BOUNDARIES.md`. Run `npm test` before pushing.
