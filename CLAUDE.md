# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

ABYSS LINE (Project 87) is a retro side-scrolling shoot-'em-up built on the theme "how would this have been implemented in 1987" — ES5, no libraries/frameworks, Web Audio-synthesized FM/SSG/ADPCM music in the style of a YM2203×2 + MSM5205×1 arcade board. It is the first title under the "Project 87" brand and has been greenlit for commercialization.

There is no build system, package manager, or framework. Static site: open `index.html` directly, or serve the repo root over HTTP(S) (e.g. `python3 -m http.server`).

## Branches — read this before touching anything

- **`main`** — a frozen, untouched snapshot of the v12 baseline under `baseline_v12/`. **Do not edit anything under `baseline_v12/`.** It exists purely as a diffable reference for "what shipped before the v13 restructuring." (There is a local git tag `v12-baseline` on the baseline commit, but it could not be pushed to GitHub — this session's git proxy returned 403 on `git push origin <tag>` while branch pushes worked fine. If you need the baseline commit and the tag isn't on the remote, the commit is `7e6f3101bdf67a9aba54be46bc94f4aa44d7d4a5` — reachable via `main`.)
- **`v13-public-test`** — the live branch. `index.html` + `script.js` at the repo root are the actual public test build; **this is what GitHub Pages deploys from** (Settings → Pages → Deploy from a branch → `v13-public-test` → `/ (root)` — not `main`, which has no root-level `index.html`). Public URL: `https://manabukomine.github.io/abyss-line/`.

## File structure

- `index.html` — thin shell only: `<!DOCTYPE>`, viewport/PWA meta tags, a ~3-line inline `<style>` (canvas + html/body reset), and `<canvas id="c">`. Loads `<script src="script.js">`. There is no other static markup — the title screen, HUD, GAME OVER screen etc. are all drawn on the canvas by JS, not DOM elements.
- `script.js` — the entire game. Two sequential top-level IIFEs in one file:
  1. **BGM_OPN module** (starts `// OPN-STYLE SOUND DRIVER v4`) — the music/SFX synth driver, exposed as `window.BGM_OPN` with `init/start/stop/setMode/setMute/setVolume/getMode`. Has its own module-private `AC` variable that becomes the *same* AudioContext as the main game's once `BGM_OPN.init(sharedAC)` is called from the game (see "Shared AudioContext" below — don't call `BGM_OPN.start()` before that init has run, or the module will lazily create its own separate `AudioContext` instead of sharing one).
  2. **Main game** (starts `// ABYSS LINE / Project 87 v12 - integrated OPN music`) — canvas rendering, input, entities, game state machine (`state`: `'title' | 'play' | 'over'`).
- `baseline_v12/` — frozen v12 reference (`abyss_line_project87_v12.html`, `.js`, `_notes.txt`). Not part of the deployed build. The original `v12.html`'s inline `<script>` is byte-identical to `abyss_line_project87_v12.js` in this folder — verified via `diff`/`sha256sum` during the v13 split, and the split itself was verified lossless by re-inlining `script.js` into `index.html`'s `<script>` tag and confirming the sha256 matches the baseline `v12.html` exactly.
- Earlier iteration history (v0–v11, and standalone BGM driver demo files) lives only in Dropbox at `/Public/mako's works/アビスライン/`, not in this repo.

## v13 is a Public Test Build — strict scope

Philosophy: **「性能ではなく、知恵で勝負する」「完成直前は、足すより守る」** ("win on cleverness, not horsepower"; "near the finish line, protect more than you add").

**No new features, weapons, enemies, or balance changes are in scope for v13.** Only:
1. Bug fixes
2. GitHub Pages compatibility
3. First-run UX polish

Agreed phase sequence:
- **Phase A** — freeze the v12 baseline (done: `main` branch).
- **Phase B** — restructure into `index.html` + `script.js`, content unchanged (done).
- **Phase C** — the developer's own real-device (iPhone Safari) playtest. Do not move to Phase D until this is clean.
- **Phase D** — first-run UX pass (e.g. is "TOUCH & DRAG TO MOVE / AUTO FIRE" enough on its own, before adding any tutorial screen). Gated on Phase C, and on first-run tester feedback (not just the developer's own read) before deciding anything.

Phase C checklist used so far (repeat for any future device-testing round):
初回起動 → 音が鳴るまで → 横画面表示 → タッチ追従 → バックグラウンド10秒→復帰 → BGM再開 → WARNING → ARMOR → CORE → 撃破 → 次ZONE → GAME OVER → 再スタート(リロードなし)

## Architecture notes

- **Canvas**: internal resolution is fixed at 640×200 (`var W=640,H=200`), scaled to the device via CSS (`cv.style.width/height`) — always draw/reason in the 640×200 coordinate space.
- **Loop**: `requestAnimationFrame` driven, but game *logic* runs on a fixed 33.333ms step via an accumulator (`acc+=dt; while(acc>=33.333){update();acc-=33.333;}`) — i.e. 30Hz logic regardless of display refresh rate. `dt` is clamped (`if(dt>100)dt=100`) to avoid a huge catch-up burst after the tab was backgrounded.
- **Shared AudioContext**: the main game creates one `AudioContext` (its own `AC`) on first user gesture (touchstart/mousedown/keydown all call `initAudio();resumeAudio();`), then does `window.BGM_OPN.init(AC)` so the driver module reuses the same context (one `AudioContext`, music gain 0.24 through the BGM module's `master`, SFX gain 0.35 through the game's own `master`, per `abyss_line_project87_v12_notes.txt`).
- **Background/foreground**: `visibilitychange` suspends (`AC.suspend()`) the shared context when hidden and resumes it when visible again. The BGM scheduler's `tick()` already guards against scheduling into a suspended context (`if(!running||AC.state!=='running')return;`) and re-syncs `nextTime` if it drifted, so it doesn't burst-fire a backlog on resume.
- **Transient effect timers** (`shake`, `flash`, `shieldFlash`, `msgT`) decay once per logic tick — but only inside `update()`'s `state==='play'` path. `update()` early-returns for any other state (`title`, `over`) *before* reaching that decay code, so if you add a new timer like these, remember to also decay it in the early-return branch (see the `state!=='play'` branch near the top of `update()`) — this exact class of bug caused the GAME OVER screen to shake forever (fixed; see git log).
- **Zone palette**: `pal()` returns a red-dominant palette for even zones (THERMAL) and blue-dominant for odd zones (TRENCH). Any new UI color drawn over the play field should be checked against *both* palettes, not just one — the boss core health bar bug (red-on-red in THERMAL zones) came from picking a color that only worked against TRENCH's blue background.

## Fixed-so-far bug log (context for "why is this like this")

- SFX `warn()` (the boss-imminent alarm) was far quieter (vol 0.12) than every other sound effect; bumped to 0.24.
- Boss core "exposed" health bar was drawn in `#f00`, blending into THERMAL zones' red terrain; changed to `#fff`.
- GAME OVER screen shook indefinitely instead of settling — see "Transient effect timers" above.

## Development workflow

No build/lint/test tooling. `node --check script.js` catches syntax errors. No unit tests exist; validate by loading `index.html` in a browser (or headless Chromium) and playing through the Phase C checklist. Real iOS Safari-specific behavior (background/foreground audio, touch, safe-area insets) cannot be verified headlessly — needs an actual device.
