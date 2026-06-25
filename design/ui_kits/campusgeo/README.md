# CampusGeo UI Kit

A high-fidelity interactive prototype of the CampusGeo campus AI geospatial agent.

## Screens covered
1. **Landing / Onboarding** — welcome screen with query prompt
2. **Main App** — full map view with sidebar, query bar, results panel
3. **Results Detail** — expanded result with map highlight
4. **Layer Controls** — map layer management panel
5. **Query History** — browsing past queries

## Components
- `AppShell.jsx` — top bar, layout grid, sidebar toggle
- `MapCanvas.jsx` — simulated dark map with markers and layers
- `QueryBar.jsx` — natural language input with suggestions
- `ResultsPanel.jsx` — scrollable results list with cards
- `LayerControls.jsx` — toggleable map data layers
- `ChatHistory.jsx` — past query list

## Design Notes
- Uses UChicago brand: Phoenix Maroon (#800000), Greystone dark surfaces
- Font substitutions: EB Garamond (for Adobe Garamond Pro), Plus Jakarta Sans (for Gotham)
- Dark-mode map application — near-black canvas with warm grey surfaces
- Lucide icons throughout
- Simulated Mapbox-style dark map using CSS/SVG placeholders

## Usage
Open `index.html` to see the full interactive prototype.
