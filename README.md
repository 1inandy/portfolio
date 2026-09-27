# Andy Lin — Portfolio

My personal site: selected projects, photography, and a few live widgets (GitHub
contributions, Duolingo streak, local clock). Plain HTML, CSS, and JavaScript with
no framework and no runtime dependencies.

## Run locally

Requires Node 20.6+ (for `--env-file`).

```sh
cp .env.example .env   # required by the dev script; values are optional
npm run dev
```

Then open http://localhost:3000. The local server serves the site and the `/api/*`
endpoints, so every widget works during development.

## Build

```sh
npm run build
```

Copies the site into `dist/` for deployment. `dist/` is generated: edit files in
`assets/` and `index.html`, then rebuild. Never edit `dist/` by hand.

## Deploy (Heroku)

Heroku runs `npm run build` and then `npm start`, which runs `node server.js` with no
`.env` file. Set the variables below as Heroku config vars instead:

```sh
heroku config:set DISCORD_DUOLINGO_WEBHOOK_URL=... -a <app>
```

## Project structure

| Path | What it is |
| --- | --- |
| `index.html` | Page markup and all copy |
| `assets/css/styles.css` | Styling |
| `assets/js/main.js` | Clock, widgets, reveal and hover interactions, photo viewer, cursor |
| `assets/js/magnetic-scroll.js` | Section-to-section wheel snapping |
| `assets/js/point-cloud.js` | Background dot field |
| `assets/js/liquid-cursor.js` | Custom cursor trail |
| `assets/photos/` | Gallery thumbnails; `full/` holds the viewer images |
| `api/` | Serverless endpoints: GitHub contributions, Duolingo status, Duolingo nudge |
| `worker/index.js` | The same endpoints for the edge deployment in `dist/server/` |
| `server.js` | Local dev server |
| `scripts/build.mjs` | Build script |

## Environment

| Variable | Purpose |
| --- | --- |
| `DISCORD_DUOLINGO_WEBHOOK_URL` | Discord incoming webhook for the "Remind me to practice" button. Without it, the button says reminders aren't configured. |
| `DUOLINGO_TIME_ZONE` | Day boundary for the streak. Defaults to `America/New_York`. |

Secrets stay on the server. The Duolingo lookup uses only the public profile and
is cached for five minutes, and each visitor can send one reminder every 15 minutes.

## Accessibility

All content is real DOM text. Motion respects `prefers-reduced-motion`, and on touch
devices the custom cursor is off and project details are always shown.
