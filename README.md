# Gym Rush

A raccoon has stolen the town's only tub of protein. You and your gym crew chase it down winding, procedurally built roads through four districts, striking the pose cut into each wall to burst through it.

**Play:** https://justjammin.github.io/pump-parade/

The whole game is `index.html`: canvas rendering, Web Audio sound, no dependencies.

## Controls

| Pose | Keyboard | Touch |
|------|----------|-------|
| Point left | ← or A | Point (left) |
| Most muscular | ↓ or S | Crab |
| Double biceps | ↑ or W | Biceps |
| Point right | → or D | Point (right) |

P or Esc pauses. M mutes.

## Install on a phone

The GitHub Pages build is an installable web app. It gets a home-screen icon, runs full screen, and plays offline after the first visit.

- **iPhone or iPad:** open the play link in Safari, tap Share, then Add to Home Screen.
- **Android:** open the play link in Chrome, open the menu, then Install app.

## Build

```bash
npm run build
```

`build.mjs` uses only Node built-ins. It reads `index.html` and the artwork in `art/`, and writes:

- `dist/web/`: the installable web app (manifest, icons, social preview image, offline service worker). Every push to `main` deploys it to GitHub Pages.
- `dist/itch/` and `dist/pump-parade-itch.zip`: the itch.io HTML5 build.
- `dist/itch-cover.jpg`: a 630×500 cover image for the itch.io page.
- `dist/crazygames/` and `dist/gym-rush-crazygames.zip`: the CrazyGames build, which loads the CrazyGames SDK.

Each host is a row in the `PLATFORMS` table in `index.html`: how it saves the best score, plays ads, reports gameplay starting and stopping, and celebrates a new best. The game picks the CrazyGames row when the SDK is loaded and running, and the web row everywhere else.

## Store art

`art/` holds the icons, covers, feature graphic and screenshots for the site, itch.io, CrazyGames and Google Play. Two tools in `tools/store-art` make them:

- `npm run art` generates the key art with the Higgsfield CLI from prompts in `art.mjs`, and crops each image to its size. It needs `higgsfield auth login` first. Raw generations stay in `tools/store-art/raw/` and are reused, so a rerun spends no credits unless you pass `--force <asset>`.
- `CHROMIUM=<path> npm run shots` plays the real game on a phone-sized screen with an autopilot and frames four moments with captions, as 1080×1920 store screenshots.

Stores require screenshots to show the real game, so only the key art is generated.

## Publish on CrazyGames

On CrazyGames the game opens straight into a run, reports gameplay start and stop, saves the best score through the SDK, mutes when the CrazyGames sound setting is off, and asks for a midgame ad when the player taps **March again**. The SDK spaces those ads out itself, and if an ad fails or is blocked the next run starts anyway.

1. In the CrazyGames developer portal, submit a new HTML5 game and upload `dist/gym-rush-crazygames.zip`.
2. Upload the covers `art/crazygames-landscape-1920x1080.jpg`, `art/crazygames-portrait-800x1200.jpg` and `art/crazygames-square-800x800.jpg`.
3. Turn on **Progress Save**. Without it the SDK's data module is off, and the best score is not kept between visits.
4. Fill in the description and the controls from the table above, and add a gameplay video.

To try the CrazyGames build locally, serve `dist/crazygames` on `localhost` or `127.0.0.1`. The SDK runs in local mode there: ads show as a placeholder overlay and every SDK call is logged to the console.

See `docs/distribution.md` for where CrazyGames fits among the other channels.

## Publish on itch.io

1. On itch.io, create a project with **Kind of project** set to **HTML**.
2. Upload `dist/pump-parade-itch.zip` and tick **This file will be played in the browser**.
3. Under **Embed options**, tick **Mobile friendly** and **Fullscreen button**, and set the viewport to 960 × 640.
4. Upload `dist/itch-cover.jpg` as the cover image.
5. Keep visibility on **Draft** or **Restricted** until you want it public.

To push updates from the command line instead, install [butler](https://itch.io/docs/butler/installing.html), run `butler login` once, then:

```bash
ITCH_TARGET=<itch-user>/<game-slug> npm run push:itch
```
