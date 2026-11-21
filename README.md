# Spoor

Find walking, hiking and trail-running routes near you, save maps and wildlife for places with no signal, and share where you are as a what3words address with someone you trust.

Runs on **iPhone** (Safari → Share → Add to Home Screen), **Mac** and **Windows** (desktop app or any browser).

Live: https://astrokidstudios.github.io/spoor/

## What it does

- **Trails**: searches OpenStreetMap for hiking, walking and running routes and named mountain paths in the area on the map. Shows distance, difficulty (from `sac_scale`), climb and an elevation profile (Open-Meteo), and rough walking and running times.
- **Offline**: saves the area in the orange box: map tiles, every trail in it and its wildlife. The map, trails and species guide then work with no signal.
- **Share**: sends your location every 5 minutes (adjustable) to a private link. Your contact opens the link in any browser and sees your what3words address, the time of the fix and a map of where you've been. Send the link by WhatsApp, SMS or copy.
- **Wildlife**: species recorded in the area (research-grade iNaturalist observations) with photos and short descriptions, saved for offline use. Tick off what you've seen.

## Things you supply

| What | Why | Where |
| --- | --- | --- |
| what3words API key | Turns GPS into three words. Without it, sharing sends coordinates. | developer.what3words.com → Settings in Spoor |
| Thunderforest key (optional) | Bigger, more detailed offline areas with the Outdoors map. | thunderforest.com → Settings in Spoor |

## How live sharing works

No server of our own. Each share creates a random, unguessable topic on [ntfy.sh](https://ntfy.sh) (free, open source). The app posts each update there; the follow page (`#/follow/<topic>`) reads it. Updates are kept by ntfy for about 12 hours. You can point Spoor at your own ntfy server in Settings → Advanced.

**iPhone limit**: Apple pauses home-screen web apps when the screen locks or you switch apps, so updates only go out while Spoor is open on screen. Spoor keeps the screen awake while sharing. When you reopen it, it sends straight away. The desktop apps keep sending in the background.

## Map tiles and fair use

The default maps come from community servers (OpenTopoMap, OpenStreetMap) that ask apps not to bulk-download. Spoor keeps offline areas small with them (about 2,500 tiles, up to zoom 15) and downloads slowly. For larger areas, add a free Thunderforest key.

## Develop

```bash
npm install
npm run dev          # web app at http://localhost:5173
npm run build        # production build in dist/
npm run desktop      # run the desktop app
npm run dist:win     # Windows installer + portable exe in release/
npm run dist:mac     # Mac .dmg (on a Mac)
```

Tests (use fake versions of every outside service, so no internet needed):

```bash
npm run build && npx vite preview --port 4174 &
node test/e2e.mjs test/out
```

Pushing to `main` deploys the web app to GitHub Pages. Pushing a tag like `v1.0.0` builds the Mac and Windows apps in GitHub Actions and attaches them to a release.

Data © OpenStreetMap contributors (ODbL). Species data and photos from iNaturalist and their photographers. Elevation from Open-Meteo.
