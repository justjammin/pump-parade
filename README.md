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
- `dist/crazygames/`, `dist/gamepix/` and `dist/gamedistribution/`, each zipped as `dist/gym-rush-<portal>.zip`: portal builds that load the portal's SDK. The GameDistribution build needs the game ID from the GameDistribution developer portal, as `GD_GAME_ID=<id> npm run build`; without it, that build is skipped.
- `dist/telegram/`: the Telegram Mini App page.

Each host is a row in the `PLATFORMS` table in `index.html`: how it saves the best score, plays ads, reports gameplay starting and stopping, and celebrates a new best. A host row starts from the web row and overrides only what its host does, and its `init` checks at boot whether the game is running on that host. The game uses the first host that reports itself live, and the web row everywhere else. A new host is one row in `PLATFORMS` and one entry in the `HOSTS` table in `build.mjs`.

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

## Publish on GameDistribution

GameDistribution pauses and mutes the game around its ads, and **March again** asks for an interstitial.

1. In the GameDistribution developer portal, create the game and copy its game ID.
2. Build with `GD_GAME_ID=<id> npm run build` and upload `dist/gym-rush-gamedistribution.zip`.
3. Open the game in the portal's preview and watch the pre-roll ad through once. This activates the SDK integration.
4. Before the rewarded "keep going" continue ships, turn on **Rewarded Ads** for the game in the portal. Without it the game cannot request rewarded ads.

To see fake ads while testing, run `gdsdk.openConsole()` in the browser console. Clear the page's local storage to turn the console off again.

## Publish on GamePix

GamePix pauses and mutes the game around its ads and follows the player's GamePix sound setting. **March again** asks for an interstitial, and a new best score is reported as a happy moment. GamePix syncs the best score itself, from local storage.

1. Upload `dist/gym-rush-gamepix.zip` to the GamePix partner portal.
2. Add the covers, screenshots, description and controls.

Served on `localhost`, the SDK simulates the GamePix player, with a placeholder overlay for each ad. Query parameters pick the ad results, for example `?gpx_ad=nofill&gpx_reward=cancel`.

## Publish as a Telegram Mini App

Inside Telegram the game expands to full height, turns off swipe-to-close so poses don't close it, pauses when the player minimizes it, and buzzes on a new best score. Opened anywhere else, the same page runs as the web game.

1. Host `dist/telegram/` at an HTTPS address of its own. Keep it out of the web app's folder on GitHub Pages, because the web app's offline service worker covers that folder and would cache this page in place of the web app.
2. Create a bot with BotFather, then create a Mini App for it with `/newapp` and give it that address.

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
