# CampusGeo Design System
## University of Chicago AI Geospatial Agent

---

### Overview

**CampusGeo** is an AI-powered campus geospatial analysis tool — a "campus version of Aino.world" — built for the University of Chicago. Users query campus locations, buildings, and data in plain natural language, and the system automatically analyzes and generates interactive maps, layers, and insights.

**Inspiration / Reference Products:**
- Existing UChicago campus map viewer: https://uchicago.maps.arcgis.com/apps/mapviewer/index.html?webmap=012f41f00d584e6f891d65a400b6b66e (Esri ArcGIS Map Viewer, restricted access)
- Product model: https://www.aino.world/ (Aino — AI geospatial analysis for real estate)

**Target Platform:** Web application, AWS deployment

---

### Brand Foundation

CampusGeo inherits the **University of Chicago's brand identity** while adapting it for a dark-mode, data-dense map application interface.

#### UChicago Brand Sources
- Brand guidelines PDF: https://news.uchicago.edu/sites/default/files/UCM_UniversityIdentityGuidelines_2-2020.pdf
- Web guidelines: https://websites.uchicago.edu/policies-standards/web-brand-identity-guidelines/
- Creative resources: https://creative.uchicago.edu/brand-resources/

---

### CONTENT FUNDAMENTALS

**Tone & Voice:**
- Intelligent, direct, evidence-based — UChicago's own brand language
- Accessible but scholarly: uses "you" and "we" (inclusive), never jargon-heavy
- Present tense. Confident, not boastful.
- No emoji in UI chrome (occasional use in empty states/onboarding only)
- Copy should feel like a smart research assistant, not a chatbot
- Examples: "Where is the nearest food court?" → "Here are 3 dining options within 5 min walk." Not "Great question! Let me help you find food!"

**Casing:**
- Sentence case for all UI labels, prompts, descriptions
- Title Case for section headers and page titles only
- ALL CAPS never used

**Terminology:**
- "Ask" or "Query" not "prompt"
- "Campus layer" not "data layer"
- "Explore" not "analyze" in user-facing copy
- "Results" not "output"

---

### VISUAL FOUNDATIONS

**Colors:**
- Primary: Phoenix Maroon `#800000` — dominant brand color, used for headers, CTAs, active states
- Light Greystone: `#B9B0A2` — named after campus limestone buildings; used for borders, subtle UI
- Dark Greystone: `#5C5248` — for secondary text, muted UI elements
- Footer Grey: `#3D3530` — dark backgrounds in sidebars
- Map Dark: `#1A1714` — near-black canvas for map background
- Surface: `#242020` — dark card/panel surface
- Surface Raised: `#2E2A27` — elevated panels
- White: `#FFFFFF`
- Muted text: `#8C8580`
- Accent Amber: `#C4903A` — warm gold from UChicago tile roofs; used for highlights, icons

**Typography:**
- **Display/Heading:** EB Garamond (Google Fonts) — substituting for Adobe Garamond Pro, UChicago's traditional serif. Used for large display text, hero queries.
- **UI/Body:** Plus Jakarta Sans (Google Fonts) — substituting for Gotham. Modern geometric sans. Used for labels, body, nav.
- **Mono:** JetBrains Mono — for query input, map coordinates, code

**Spacing & Layout:**
- Base unit: 4px
- Component padding: 12px, 16px, 24px
- Content max-width: 1440px
- Sidebar width: 360px
- Map takes remaining viewport

**Backgrounds:**
- Dark map application — near-black base with warm grey surfaces
- No gradients on surfaces; subtle linear overlays on map edges only
- Card: `background: #2E2A27`, `border: 1px solid #3D3530`, `border-radius: 8px`

**Shadows:**
- Panels: `0 4px 24px rgba(0,0,0,0.4)`
- Cards: `0 2px 8px rgba(0,0,0,0.3)`
- No outer glow; use border for separation

**Corner Radii:**
- Buttons: 6px
- Cards/Panels: 8px
- Input fields: 6px
- Chips/Tags: 20px (full pill)
- Modal: 12px

**Animation:**
- Subtle fade-ins (200ms ease-out) for panel opens
- Map layers animate with opacity transition (300ms)
- No bounces; minimal motion philosophy
- Hover: slight background lightening (+10% luminance)
- Active/press: scale(0.98) on buttons

**Iconography:**
- Lucide Icons (CDN) — consistent stroke weight, modern minimal
- Map-specific: map-pin, layers, search, compass, zap (AI), route, building
- Never emoji as icons

**Imagery:**
- Photography: striking, documentary style — Gothic campus architecture, aerial campus shots
- Color treatment: slightly desaturated, cool-to-neutral (fits dark UI)
- No stock photography feel

**Cards:**
- Dark surface, subtle border, 8px radius
- Light text on dark background always
- Map result cards: left icon stripe in maroon, content right

**Layout Rules:**
- Full-viewport map canvas always visible
- Left sidebar: collapsible, 360px, contains chat/query history
- Right sidebar: results panel, 400px, context-dependent
- Top bar: 56px, maroon accent bar with UChicago phoenix + product name

---

### ICONOGRAPHY

**Icon Library:** Lucide Icons — loaded from CDN (`https://unpkg.com/lucide@latest/dist/umd/lucide.js`)
- Stroke-weight: 1.5px, consistent throughout
- Size: 16px (inline), 20px (buttons), 24px (primary actions)

**Brand-specific icons:**
- UChicago Phoenix (SVG) — stored in `assets/phoenix.svg`
- Map pin variants for different campus POI types

**No emoji used in UI** — emoji are only acceptable in user-typed query text.

---

### File Index

```
README.md                     — This file
SKILL.md                      — Agent skill definition
colors_and_type.css           — CSS design tokens
assets/
  phoenix.svg                 — UChicago phoenix logo (SVG)
  uchicago-wordmark.svg       — UChicago wordmark
preview/
  colors-primary.html         — Primary color swatches
  colors-semantic.html        — Semantic UI colors
  colors-surface.html         — Dark surface system
  type-display.html           — Display/heading type specimens
  type-ui.html                — UI/body type specimens
  spacing-tokens.html         — Spacing scale
  spacing-radii-shadows.html  — Radii + shadow system
  components-buttons.html     — Button states
  components-inputs.html      — Input / query field
  components-cards.html       — Result cards
  components-badges.html      — Layer chips, tags
  components-sidebar.html     — Sidebar panel
  brand-logo.html             — Logo lockup
ui_kits/
  campusgeo/
    README.md                 — UI kit notes
    index.html                — Main app prototype
    AppShell.jsx              — Layout shell
    MapCanvas.jsx             — Map display component
    QueryBar.jsx              — Natural language input
    ResultsPanel.jsx          — Results sidebar
    LayerControls.jsx         — Map layer toggles
    ChatHistory.jsx           — Query history list
```
