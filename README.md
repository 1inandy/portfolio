# Kai Renner Portfolio

A dependency-free personal portfolio site.

## Run locally

```sh
npm run dev
```

Then open the local URL printed by the server. The site entry point is `index.html`.
The local server also runs the Duolingo endpoint, so the widget works during development.

## Project structure

- `index.html` — page markup and editable portfolio content
- `assets/css/styles.css` — responsive styling
- `assets/js/main.js` — clock, contribution graph, hover preview, and scroll interactions
- `api/duolingo.js` — cached Duolingo status endpoint (Vercel serverless function)
- `Portfolio.dc.html` — original design-export source, retained for reference

Before publishing, replace the placeholder social links, email address, and project URLs in `index.html`.

## Duolingo widget

The Duolingo card reads Andy's public profile through `/api/duolingo`, which is a Vercel serverless function. Deploy this project on Vercel (rather than a static-only host) for the live status to work. It caches the public lookup for five minutes and never uses a Duolingo password or token. Visitors who leave the page open recheck the status every five minutes.

`DUOLINGO_TIME_ZONE` defaults to `America/New_York`. Set that environment variable in Vercel if the Duolingo account uses a different local day boundary.

## Visitor Duolingo nudges

Visitors can select the bell labeled **Remind me to practice**. The site sends a Discord incoming-webhook message from the server; no visitor data or webhook secret is exposed in the browser. Create a Discord webhook in the channel where you want reminders, then set its URL as the `DISCORD_DUOLINGO_WEBHOOK_URL` environment variable locally and in Vercel.

Each visitor address can send one reminder every 15 minutes. If the environment variable is not set, the button explains that reminders are not configured.
