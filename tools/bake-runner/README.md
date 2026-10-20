# Runner sprite bake

The player and crew are drawn from a sprite sheet baked from a rigged 3D model. This tool turns the model into the `RUNNER` block in `../../index.html`, so the game stays a single file with no runtime dependencies.

## Run it

```bash
cd tools/bake-runner
npm install
CHROMIUM=/path/to/chromium npm run bake -- path/to/runner.glb
cd ../.. && npm run build
```

`CHROMIUM` is any Chromium or chrome-headless-shell binary, for example the one Playwright installs under `~/Library/Caches/ms-playwright`.

The model is not checked in (4.1 MB). The current sheet comes from Higgsfield job `0618ecb5-eca5-4461-8484-45b1022012f4`: Meshy v7 image-to-3D with rigging and the RunFast animation, made from an original character concept.

## What it does

1. `curl.mjs` curls the fingers into fists. Meshy's rig has no finger bones, and it returned open hands even from a fists concept, so the hand mesh is folded in bind space at the three finger joints, which lays the fingertips flat against the palm. It also records which way each palm faces on the hand joint.
2. `bake.mjs` serves `bake.html` to headless Chromium. The page poses the model with `rig.js` and renders every frame three times from the chase-cam angle: part classes, plain white lighting for shade, and depth for the ink outline.
   - 12 run frames, then 6 frames each for the up, down and left poses. The game mirrors left for right.
   - In pose frames the legs keep running and the arms hold the screen angles from `POSES` in `index.html`. Each forearm rolls so the palm faces down. In the double biceps the forearms are upright, so the wrists also curl the fists in toward the head. Run frames keep the animation's own arms.
3. `bake.mjs` packs the frames into one sheet and writes it as two WebP images: shade as lossy grey, and part class plus coverage as lossless grey with alpha.

At load the game combines the two images once per palette (the player, each recruit color, and the white flash), so every crew member keeps their own skin, hair and trunks colors.

## Why baked sprites instead of live three.js

Both were prototyped in the game. Frame time is main-thread milliseconds per frame (game update plus drawing), measured in headless Chromium on an Apple M4 at 375×812, 2× pixel ratio and 4× CPU throttling: 600 frames with eight crew and an autopilot that strikes every wall, three runs each. Baselines drift between sessions, so each row lists the 2D figures from `main` measured in the same session.

| | Median | 95th percentile | 2D on `main`, same session (median / p95) |
|---|---|---|---|
| Baked sprites, this branch | 2.3–2.7 ms | 3.7–4.3 ms | 2.4–2.5 / 3.5–3.9 ms |
| Live three.js prototype | 8.6–10.1 ms | 12.2–15.8 ms | 3.0–3.9 / 4.7–5.9 ms |

Added to `dist/web/index.html`, gzipped:

- Baked sprites: +111.5 KB (27.7 KB → 139.3 KB).
- Live three.js: about +446 KB (the three.js bundle is 145 KB and the model as base64 is 301 KB).

Every build kept a 16.7 ms median frame interval (60 fps) when the machine was otherwise idle. With other work running, the live version fell to 20 fps while 2D and sprites held. Its cost is script time in the animation frame (one three.js render, skeleton update and blit per figure), not the GPU. Walls and crew interleave by depth, so a separate WebGL layer over the 2D canvas cannot draw them in the right order, and every figure had to be rendered and copied into the 2D canvas.

Sprites cost:

- One fixed camera angle, and arms snap between poses instead of blending.
- One frame per run, about 10.5 s in, takes 23–28 ms (throttled) on the sprite builds, against a worst frame of 7–8 ms on `main`. The cause is not known yet; forcing a garbage collection after load does not remove it.
- Each palette sheet is a 2048×768 canvas, about 6.3 MB of memory, so seven palettes take about 44 MB.
- The sheet is drawn at 1.4 pixels per figure unit, so it is upscaled about 2.2× on a 1440-pixel-wide retina window and looks soft there.
