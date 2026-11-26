# MC Command Simulator

Offline simulator for Minecraft Bedrock (NetEase) commands. TypeScript engine, React UI, Electron desktop shell.

## Commands (run in `mc-command-sim`, use `npm.cmd` in PowerShell because `npm.ps1` is blocked)
- `npm test` runs `node --test tests/*.test.ts` (Node runs the TypeScript directly; imports need the `.ts` extension).
- `npm run typecheck` runs `tsc --noEmit`.
- `npm run dev` starts the Vite dev server for the renderer only; the app has no browser mode and needs the Electron preload (`MC_SIM_DEV_URL` points Electron at it).
- `npm run desktop` builds the UI and starts the Electron app.
- `npm run desktop:dir` builds the unpacked app into `release/win-unpacked`.
- `npm run desktop:dist` builds the installer and the portable exe into `release/`.
- `node src/cli.ts check|run|test|export <file|-> ... [--json]` is the command line tool (see docs chapter 11); `npm run cli:build` bundles it into `dist-cli/mcsim.mjs`. The old form `node src/cli.ts examples/demo.mcsim [chain] [--ticks N] [--export commands|manifest]` still works. `check` reports the same diagnostics as the editor; exit codes: 0 fine, 1 diagnostics/command errors/failed tests, 2 usage errors.
- Core modules (`src/language`, `src/engine`, `src/nbt`, `src/bdx`, `src/convert`, `src/export.ts`) must stay free of UI, React, Electron and browser globals (`tests/core-boundary.test.ts` enforces it).
- `node src/cli.ts file.mcsim --test` runs the `test` blocks of a script (exit 1 on failure).
- Electron smoke test: set `MC_SIM_SMOKE=1` and start the app; it prints `SMOKE_RESULT ...` and exits 0 when the UI loaded.

## Environment gotchas
- `ELECTRON_RUN_AS_NODE=1` is set in the Devin shell. Remove it (`Remove-Item Env:ELECTRON_RUN_AS_NODE`) before starting Electron, otherwise `require('electron')` returns a path string.
- GitHub downloads are slow here. Use `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` and `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/` for `node node_modules/electron/install.js` and electron-builder.
- npm skips install scripts, so after `npm install` run `node node_modules/electron/install.js` to download the Electron binary.
- Stop the Vite dev server before running electron-builder: its file watcher holds handles in `release/` and causes EPERM on rename and undeletable folders. `vite.config.ts` now ignores `release/` and `dist/`.
- `Set-Content -Encoding utf8` writes a BOM in Windows PowerShell 5. Never use it for JSON (package.json breaks); use `[IO.File]::WriteAllText` with `UTF8Encoding($false)`.
- Source files use CRLF line endings; multi-line string replacement from PowerShell must normalise line endings first.
- `compression: normal` and `asar: false` are required: the 32-bit 7-Zip fails on maximum compression, and pe-library fails on the asar integrity step with this Electron binary.

## Layout
- `src/language`: parser, program types, item and slot tables.
- `src/engine`: world model, command registry and implementations, scheduler (`simulation.ts`).
- `src/plugins`: plugin host, nx tree generator and verifier, particle viewer.
- `src/language`: also the command grammar (`grammar.ts`), completion (`complete.ts`), hover and signature help (`hint.ts`) and the `test name:` block parser (`testdsl.ts`).
- `src/ui`: the editor is CodeMirror 6 (`CodeEditor.tsx`, `hints.ts`, `highlight.ts`). React app, editor, inspector, desktop bridge types.
- `electron`: main process, preload, pure helpers (`lib.cjs`).

## Verified assumptions to keep
- The Bedrock Wiki 8-command FMBE prerequisite and @n work on the target NetEase version (confirmed by the user).
- `rotated as` copies pitch on the target NetEase version (confirmed by the user).
- Unverified (from general Bedrock knowledge): `/give` slot fill order, `/setblock` on an identical block fails, game rule defaults and feedback texts, command block execution rotation, `summon` default rotation.
- The smoke test window is shown without focus; a hidden window defers React effects, so editor checks run after the first tab click.
- Structure support: src/nbt/nbt.ts (little-endian NBT), src/nbt/mcstructure.ts (import/export), src/engine/structure.ts (capture/place). 	ests/fixtures/test_structure.mcstructure is the real NetEase sample. Never open large user .mcstructure files with editor tools; dump them through the NBT reader with limited output instead.
- 
ode src/cli.ts file.mcsim --test --only a,b runs only the named tests.
- Verified in game with probe commands (user, 2026-11): absolute x/z written without a decimal point are block centres (+0.5) in every command position (`positioned`, `facing`, `tp`, `summon`, ...); y and `~`/`^` are unaffected. `readCoords` in `src/engine/args.ts` implements it. Trig and atan2 precision match the game to 0.01 at 100000 blocks.
- Declarations follow the same rule: `ent(position=...)` x/z written without a decimal point are block centres (`resolveEntityPos` in `src/language/parser.ts`); position variables keep their written texts so `${p}` expands the same way. Regression fixture: `tests/fixtures/scp_logo.mcsim`.
- BDX export: `src/bdx/bdx.ts` builds/reads the uncompressed content; the main process adds `BD@` + brotli (`bdxFile` in `electron/lib.cjs`). Block entity data of any block is kept in `BlockData.entityNbt`. Format reference: github.com/Happy2018new/bdump-docs (BDump v3).
- `src/convert/to-mcsim.ts` turns structure cells into script text (fill merging, chain rebuilding); `src/bdx/entity-commands.ts` turns entities into a command block chain for BDX; `src/nbt/snbt.ts` is the text NBT used by `block(..., nbt=...)`. Command blocks run their `~ ~ ~` at the block centre (user-confirmed).
- App icon: design/icon/icon-command-block.svg is the source; build/icon.ico (package.json win.icon) and electron/icon.png (BrowserWindow icon) are rendered from it through an offscreen Electron window (one window reused for all sizes; creating a second window per size failed to load).
