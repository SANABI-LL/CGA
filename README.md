# CampusGeo — UChicago GIS Intelligence

Natural-language interface to the University of Chicago campus geospatial database. Users ask questions in English or Chinese; the agent interprets intent via Claude tool use (AWS Bedrock), queries campus data layers, and renders results as editorial cartography.

**Authoritative project documentation lives in [`CLAUDE.md`](CLAUDE.md)** — design language (binding), commands, repository architecture, engineering conventions, and the development roadmap. When any document conflicts with `CLAUDE.md`, `CLAUDE.md` wins.

## Quick start

```bash
pnpm install
pnpm dev:server   # local agent API (SSE) at :3001 — requires AWS credentials for Bedrock
pnpm dev          # frontend at :5173
```

Point the frontend at the local API via `apps/web/.env.local`:

```
VITE_API_URL=http://localhost:3001
```

## Further reading

- [`CLAUDE.md`](CLAUDE.md) — design system, architecture, roadmap
- [`QUICKSTART.md`](QUICKSTART.md) — Phase 1 data deployment (S3 + DynamoDB)
- [`README_ARCGIS.md`](README_ARCGIS.md) — geodatabase → GeoJSON conversion environment
- `docs/archive/` — superseded documents (including the earlier dark-mode design system)
