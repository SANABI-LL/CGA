# Git Commit Guide — Claude Design → CGA repo

This folder holds the **authoritative artifacts from Claude Design**. Drop them into
your local `SANABI-LL/CGA` repo, then commit. This is the sync step from Design → Git.

## Source-of-truth rule

| File type | Home | Flows to |
|---|---|---|
| **Frontend** (`print-flow.html`) | Claude Design | → Git → S3 |
| **Backend** (`handler.js`) | Claude Code | → Git → Lambda |
| **Specs / docs** (`*.html`, `*.md`) | Claude Design | → Git (reference) |

Never edit the same file in both environments. `handler.js` is intentionally **not**
in this package — its home is Claude Code. (An older copy was removed to avoid the
"two handler.js" confusion.)

## What to commit

| File | Put in repo at | Notes |
|---|---|---|
| `print-flow.html` | repo root (or `frontend/`) | **Production frontend**, wired to live API + CDN. This is the file on S3. |
| `data/manifest.json` | matches your S3 `layers/` layout | Layer directory the frontend reads |
| `Intent Taxonomy.html` | `docs/` | 7-intent schema reference |
| `Lambda Query Handler.html` | `docs/` | Backend handler spec |
| `Fix Spec — Compound Queries.html` | `docs/` | Next backend task (green-ash bug) |
| `README.md` | `docs/` | Full design + screen spec |
| `colors_and_type.css` | `frontend/` or `docs/` | Design tokens |
| brand assets (shield, wordmark, phoenix) | `assets/` | |

## Commit

```bash
# from your local CGA repo, after copying files in
git add print-flow.html data/manifest.json docs/ assets/
git commit -m "Sync from Claude Design: production frontend + specs"
git push origin master
```

## Config the frontend carries (already set)

```js
window.CAMPUSGEO_CDN_URL = 'https://du0vacooj41k3.cloudfront.net';
window.CAMPUSGEO_API_URL = 'https://blfi6fqdnc.execute-api.us-east-1.amazonaws.com';
```

## After committing — the green-ash bug

Open `Fix Spec — Compound Queries.html` in Claude Code and implement it against
`campusgeo-lambda/handler.js`. That work belongs in Code, not Design.
