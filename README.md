# maestria-content

Autonomous TikTok content pipeline for Maestria.

## Endpoints

| Route | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/generate-batch` | POST | Generate weekly carousel batch (21 scripts) |
| `/api/sync-tiktok-stats` | POST | Pull TikTok stats into Supabase |
| `/api/update-piece-stats` | POST | Manually update piece metrics |

## Environment Variables

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
TIKTOK_ACCESS_TOKEN=     # added after TikTok Developer approval
```

## Deploy

```bash
npm install
vercel --prod
```
