# CampusGeo Development Workflow Skill

How Claude Code and Claude Design divide responsibilities and hand off between each other. Based on practical experience from the CampusGeo project in 2026-08.

---

## Four-Step Cycle

### Step 1 — Claude Code: wire up the functionality
- Identify requirements, write tools, connect to Bedrock, verify data can be fetched from S3.
- Frontend gets the simplest prototype needed to exercise the logic — no visual investment yet.
- **The deliverable of this step is not a UI, it is a contract**: SSE event types, `mapUpdate` structure, exact field names returned by each tool. Write it up in `docs/FRONTEND_INTEGRATION.md`.

### Step 2 — Claude Design: build the frontend
Do not hand over the prototype HTML and ask Design to "improve" it — that structure was written to wire up logic, and revising it is slower than starting fresh. Instead:

- Give Design the contract (a repo link is enough; Design can read `docs/FRONTEND_INTEGRATION.md`, `handler.ts`, `agent.ts`, and the `tools/campus/*.ts` files directly).
- The prototype HTML is a reference only — its purpose is to show "these features need to exist".
- Design builds the UI from the design system from scratch, guided by this project's root `CLAUDE.md` for all visual decisions.

### Step 3 — wire up the backend and debug
Connect directly to the real Lambda from inside Design — this is the most valuable step: you can see exactly what the browser receives.

Divide the work by **layer**, not by **bug**:
- Data, filter logic, AI answer content, tool definitions → Claude Code
- Layout, interactions, map rendering styles, print layout → Claude Design

**Counter-intuitive but important**: bugs are often faster to locate in Design first; bring the diagnosis back to Code for the fix. Examples:
- "Buildings before 1930" returning all buildings → Design traced it to `parseFloat(x || '0')` turning missing years into 0, and `0 < 1930` always being true.
- Blank map → Design traced it to `mapUpdate.features` being a bare array rather than a FeatureCollection.
- Internal error → Design located the fail-open branch in `queryS3Layer` throwing an exception.

### Step 4 — back-flow (easiest step to skip)
Design produces a self-contained HTML file. **It does not automatically become a React component in the repo.** Without this step, the two sides diverge. Three options — pick based on project needs:

| Option | Use when |
|---|---|
| Ship the bundled HTML as-is | Demo, internal sharing |
| Have Claude Code rewrite `apps/web` components to match Design | Long-term maintained product |
| Treat Design as a visual exploration; migrate to repo after designs stabilize | Design is still in flux |

When choosing option 2, ask Design to produce a handoff document first: color tokens, spacing, interaction states, map layer configuration, print layout parameters.

---

## Claude Design Capability Boundaries

**Can do**: read GitHub repositories, connect directly to backend APIs for live debugging, see real responses in the browser, diagnose frontend/backend issues, bundle a self-contained HTML file.

**Cannot do**:
- Push to GitHub (read-only).
- Run your build.
- Read CloudWatch logs.
- Run WebGL — the preview sandbox blocks MapLibre's worker. **All map-related effects must be verified in a real browser at least once.**

---

## Security Constraints (non-negotiable)

- `backend-config.local.js` contains a plaintext API key — **never commit it**.
- The bundled output (`CampusGeo Landing.html`) inlines the same key — **never push to a public repository**.
- The CORS allowlist blocks browser cross-origin requests; it does not block `curl`. The real gate is `API_SECRET` (fail-closed).
- When a new origin needs access, **append it to the allowlist** — never open to `*` (see the tightening decision in `docs/worklog/2026-07-15.md`).
- Raw layer columns (`FCI` / `RI` / `RICOST` / `F2026`–`F2035` cost projections) must not be sent to the browser. New tools should allowlist fields the same way `getBuildingInfo.ts` `pickBuildingProps` does.

---

## Handoff Checklist

**Code → Design, include**:
- Which tools changed.
- New or modified field names.
- Exact structure of `features` (FeatureCollection or bare array).

**Design → Code, include**:
- Located root cause (file + behavior).
- Expected return structure.
- Description of any backend changes needed to support the fix (Design writes these as md files, e.g. `bug-year-filter.md`, `lambda-cors-patch.md`).

**After every Design change to map-related functionality**: click through it once in a real browser to confirm rendering is correct.
