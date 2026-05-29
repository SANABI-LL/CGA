---
name: campusgeo-design
description: Use this skill to generate well-branded interfaces and assets for CampusGeo, the University of Chicago AI Geospatial Agent. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping a campus-scale AI-powered map application.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick reference

**Brand:** University of Chicago — Phoenix Maroon + warm Greystone dark surfaces
**Primary color:** #800000 (Phoenix Maroon)
**Accent:** #C4903A (tile roof gold)
**Canvas/bg:** #1A1714 (near-black map background)
**Surfaces:** #242020 → #2E2A27 → #3D3530
**Fonts:** EB Garamond (display, italic queries), Plus Jakarta Sans (UI/body), JetBrains Mono (coordinates, code)
**Icons:** Lucide Icons (CDN: https://unpkg.com/lucide@latest/dist/umd/lucide.js)
**Tone:** Intelligent, direct, evidence-based. Sentence case. No emoji in UI chrome.

## Key files
- `README.md` — full design system documentation
- `colors_and_type.css` — all CSS tokens (import first)
- `assets/phoenix.svg` — UChicago phoenix mark
- `assets/uchicago-wordmark.svg` — full brand wordmark
- `ui_kits/campusgeo/index.html` — interactive app prototype
- `preview/` — design system cards (colors, type, spacing, components)
