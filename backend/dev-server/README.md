# @campusgeo/dev-server

Local SSE server that runs the CampusGeo Bedrock agent without deploying the
Lambda Function URL. It mirrors the production handler's contract so the
frontend behaves identically against local and deployed backends.

## Endpoints

- `POST /api/agent` — body `{ "query": string, "sessionId"?: string }`, responds
  `text/event-stream` (`data: {json}\n\n` events: `text`, `tool_call`,
  `tool_result`, `done`, `error`).
- `GET /health` — readiness check.

## Run

```bash
pnpm install
pnpm dev:server          # from repo root, or:
pnpm --filter @campusgeo/dev-server dev
```

The agent calls Amazon Bedrock, so AWS credentials must be present in the
environment (the same ones the Lambda uses):

```bash
export AWS_REGION=us-east-1
export AWS_PROFILE=campusgeo          # or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
export BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0   # optional
export PORT=3001                       # optional, default 3001
```

Then point the frontend at it in `apps/web/.env.local`:

```
VITE_API_URL=http://localhost:3001
```

## Notes

- Runs the TypeScript directly via `tsx` (no build step). `dev` watches for
  changes; `start` runs once.
- Imports `runCampusGeoAgent` straight from `../lambdas/ai-agent/agent.ts`, so
  any change to the agent or its tools is picked up immediately.
