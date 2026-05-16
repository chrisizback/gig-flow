# GIG FLOW Deployment Checklist

## Current Hosting Split

- Frontend PWA: deploy the static app (`index.html`, `app.js`, `sw.js`, `manifest.json`, assets) to Vercel, GitHub Pages, or another static host.
- Backend: deploy `server/push-server.mjs` to Railway or another long-running Node.js host. Do not deploy the push polling loop to short-lived serverless functions.

## Required Backend Environment Variables

```bash
DATABASE_URL="file:./dev.db"
VAPID_SUBJECT="mailto:support@example.com"
VAPID_PUBLIC_KEY="generated-public-key"
VAPID_PRIVATE_KEY="generated-private-key"
GIGFLOW_PUSH_INTERVAL_MS="180000"
PUSH_HOST="0.0.0.0"
CORS_ORIGIN="https://your-pwa-domain.example"
DATA_UNION_HASH_SECRET="long-random-secret"
COOP_DRIVER_HASH_SECRET="long-random-secret"
COOP_WEBHOOK_SIGNING_SECRET="long-random-secret"
GIGFLOW_INTERNAL_API_TOKEN="server-to-server-driver-telemetry-token"
GIGFLOW_DRIVER_INGEST_TOKEN="short-lived-or-server-issued-driver-ingest-token"
GIGFLOW_DATA_UNION_API_KEYS="licensed-third-party-key-1,licensed-third-party-key-2"
GIGFLOW_COOP_PARTNERS_JSON='[{"id":"coop-colorado","name":"Drivers Cooperative Colorado","apiKey":"partner-api-key","webhookUrl":"https://coop.example/webhooks/gig-flow","scopes":["COOP_DISPATCH","COOP_TELEMETRY"]}]'
```

## Frontend Runtime Configuration

Set these before `app.js` loads, either in a generated `config.js` file or an inline script served by your static host:

```html
<script>
  window.GIG_FLOW_PUSH_API_BASE = "https://your-railway-backend.example";
</script>
```

Do not expose `GIGFLOW_INTERNAL_API_TOKEN`, co-op API keys, VAPID private keys, Data Union export keys, or webhook signing secrets in frontend code.

## Local Commands

```bash
npm install
npm run push:vapid
npm run db:generate
npm run db:push
npm run preflight:prod
npm run push:dev
npm test
```

## Frontend Deploy Commands

```bash
npm i -g vercel
vercel login
vercel --prod
```

## Backend Deploy Commands

Railway:

```bash
npm i -g @railway/cli
railway login
railway up
```

Render:

```bash
npm install
npm run db:generate
npm run db:push
npm run preflight:prod
npm run push:dev
```

## Production Notes

- Use PostgreSQL before real launch if you outgrow the local SQLite bootstrap path.
- Keep `anonymized_trips` isolated from `users_pii`; do not add user foreign keys to the Data Union table.
- Keep the push backend as a long-running process, because the polling loop uses `setInterval`.
- Apple/iOS requires a visible notification for every Web Push wake. The service worker uses a stable notification tag to replace the active tracking notification instead of stacking alerts.
