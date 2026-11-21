# Walk We 2

Mobile-first PWA that recommends walking routes in central Bangkok around Siam
(walks up to 5 km): shadier by day, safer by night (based on available data).

The Walk We team is **หมูกรอบกับหมาไส้กรอกตะลุยอวกาศ**. The current members are
Nathaporn Saituptim (Team Lead / Developer), Natchapon Thiradechanun (AI Engineer / Developer),
and Siriphanaphorn Sirikun (Support).

- **Voice:** dictate a place name with the browser microphone and listen to navigation instructions using the browser voice or optional ElevenLabs.
- **Accessibility:** avoid stairs (step-free routing), read aloud, larger text, vibrate on each step.
- **Safety:** SOS (hold 1 s, 5 s countdown) shares your location by SMS / LINE; contacts stay on the device.

### License & attribution

Map data © OpenStreetMap contributors (ODbL 1.0); the derived dataset `data/areas/siam.json` is
ODbL. Fonts: Bai Jamjuree and Sarabun (OFL 1.1). Sponsor logos in `apps/web2/public/sponsors/`
are trademarks of their owners.

## Layout

```
apps/web2        React + Vite PWA (UI only)
packages/core   routing / shadow / scoring + adapter interfaces — runs in Node, no DOM
packages/data   Zod schemas (mirror future PostGIS tables) + dataset loaders
config/cities   per-city settings (time zone, bounds, emergency numbers, data sources)
apps/ai-proxy   Cloudflare Worker for optional ElevenLabs speech (see AI_USAGE.md)
```

Adapters (`packages/core/src/adapters`): `GeocoderAdapter` (Photon today),
`RoutingEngine` (Phase 2), `DataRepository` (static JSON today),
`PlatformAdapter` (browser today, Capacitor later). They are wired up in
`apps/web2/src/services.ts` only.

## Commands

Requires Node 22+.

```bash
npm ci
npm run dev          # http://localhost:5174
npm test             # unit tests (Vitest)
npm run typecheck
npm run test:e2e     # Playwright on iPhone SE / iPhone 15 / Pixel 7 sizes (builds first)
npm run build
npm run preview      # http://localhost:4175
npm run lighthouse   # mobile Lighthouse on every screen; fails below 90 (needs CHROME_PATH)
npm run photos       # rebuild route photo variants after dropping in real photos
```

## Optional hosted speech

The browser can read instructions aloud with its built-in voice. To enable ElevenLabs:

```bash
cd apps/ai-proxy
npx wrangler secret put ELEVENLABS_API_KEY
# Set ALLOWED_ORIGINS in wrangler.toml to the web app's exact origin.
npm run deploy
```

Build from the project root with `VITE_AI_PROXY_URL=<worker url> npm run build`.
The existing environment variable now configures speech only. Deploy the static
site with `npm exec --workspace @walkwe/web2 -- wrangler deploy`.

For local speech development, set `ALLOWED_ORIGINS="http://localhost:5174"` and
`ELEVENLABS_API_KEY` in `apps/ai-proxy/.dev.vars`, then run `npm run ai:dev` and
`VITE_AI_PROXY_URL=http://localhost:8788 npm run dev` in separate terminals.

See `ARCHITECTURE.md` for the design and scaling notes, and `TESTING_CHECKLIST.md` for the
real-device checks.

First E2E run: `npx playwright install chromium` inside `apps/web2`.

## Data

```
data/areas/siam.json            pilot dataset (OSM + BMA CCTV), served at /data/areas/siam.json
data/areas/siam-prototype.json  prototype bake, imported for regression only (not served)
data/routes/siam-centralworld.json  photo guide (both directions) + data/routes/photos/
data/incidents/bangkok.json     past incidents by OSM way id; placeholder entries are dev-only
data/precomputed/               generated shade tables (git-ignored)
docs/shadow-regression.md       new engine vs prototype engine, same input
```

```bash
npx tsx packages/data/scripts/bake-area.ts        # re-bake the pilot area (Overpass + BMA, ~2 min)
npx tsx packages/data/scripts/import-prototype.ts # re-import the prototype's siam.json
npx tsx scripts/compare-prototype.ts              # regenerate docs/shadow-regression.md
npx tsx scripts/precompute-shade.ts 2026-10       # per-edge sun exposure every 30 min (also --year 2026)
```

Route photos: drop real photos into `data/routes/photos/` using the names the guide
references (`siam-cw-01.jpg` …), then run `npm run photos` to rebuild the AVIF/WebP/JPEG
variants and blur placeholders. Until then the app shows labelled placeholders.

Add reviewed incidents directly to `data/incidents/bangkok.json`. Each entry needs `wayIds`, `category`, `occurredOn`, `window`, `severity` and at
least one `sources` link with a date; the schema rejects any other field, so names can't be
stored. Entries with `placeholder: true` are shown (labelled) in dev and stripped from builds.

Every layer in a dataset records its `source` (name, URL, license) and `updatedAt`.
The BMA CCTV layer has no stated license; commercial use needs BMA permission.

## Config

External URLs come from env (`apps/web2/.env.example`): MapLibre styles
(OpenFreeMap), the Photon geocoder, and the optional error-tracking endpoint.
The public Photon server is fair-use and for development; point production at
a self-hosted instance before launch.

## Privacy

Saved places, recents and (later) emergency contacts live in localStorage
only. Location is never logged; the error reporter scrubs coordinates.
