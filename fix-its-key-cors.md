# Fix: rotate API_SECRET into Secrets Manager + tighten CORS

**ITS ticket:** TASK06959615  
**Requested by:** ITS security review, 2026-10  

## Changes required

### 1. Rotate `API_SECRET` into AWS Secrets Manager

- Create a secret in Secrets Manager (same region as Lambda, `us-east-1`): `campusgeo/api-secret`
- Update `campusgeo-query` Lambda to fetch the secret at cold start (cache in module scope, refresh on error)
- Remove `API_SECRET` from Lambda environment variables
- Update `backend-config.local.js` template (`backend-config.example.js`) with a note that the key is now managed in Secrets Manager; the local override file still supplies `apiKey` for browser → Lambda auth but it is never committed

### 2. Restore `ALLOWED_ORIGIN` to two explicit origins

Current state: `ALLOWED_ORIGIN` is set to `*` (opened temporarily during development).

Restore to:
```
http://localhost:5173, https://<production-cloudfront-domain>
```

In `handler.ts` (or the CORS middleware), read `ALLOWED_ORIGIN` from the environment and return it verbatim in `Access-Control-Allow-Origin`. If the value contains a comma-separated list, check `Origin` against it and echo back the matching origin (single-value CORS header requirement).

### 3. Verify

- Local dev (`pnpm dev:print` at port 5173) → requests succeed
- Production CloudFront → requests succeed  
- Any other origin → `403 Forbidden`
