# GasRank

GasRank is a mobile-first web app that ranks nearby gas stations by effective total cost, including driving fuel and optional time cost.

## GitHub Pages

This repository includes `.github/workflows/pages.yml` so the static frontend is deployed automatically to GitHub Pages when you push to `main`.

Important:

- GitHub Pages can serve static files only.
- The current price enrichment endpoint is `/api/prices`, which is implemented in `server.js`.
- `server.js` does not run on GitHub Pages.

If you want the Pages site to use real municipality price data, deploy the backend separately and set `window.GASRANK_API_BASE` in `config.js` to that backend origin.

Example:

```js
window.GASRANK_API_BASE = "https://your-backend.example.com";

