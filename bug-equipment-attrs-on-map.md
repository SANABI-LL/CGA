# Bug: equipment queries map host footprints, not equipment features

**Reported:** 2026-10-19  
**Affects:** "color by manufacturer", "color by asset type" and any attribute-driven legend on equipment layers  

## Symptom

When a user asks about electrical panels, fire extinguishers, or other equipment layers, the backend returns the host **building** footprints in `mapUpdate` instead of the equipment point/polygon features. The equipment attributes (Manufacturer, AssetNum, InstallDate, etc.) are not on the mapped features. Consequently, "color the map by manufacturer" triggers the "No *Manufacturer* values on the mapped features…" notice.

## Root cause

Tools such as `query_equipment` (or whichever tool handles equipment layers) enrich results with building context but only forward the building geometry in `mapUpdate`. The equipment features themselves are dropped before the SSE event is emitted.

## Fix

In each equipment-layer tool handler, ensure `mapUpdate.features` contains the **equipment features** (with their full attribute set), not the host building footprints. If building context is still needed in the answer text, include it in the tool result body; do not replace the equipment geometry with the building geometry.

## Acceptance

- "Show electrical panels near Crerar" → equipment points appear on the map
- "Color by manufacturer" → categorical legend with ≥ 2 Manufacturer values appears
- Building name / address still appears in the popup (pulled from a separate `get_building_info` call or from a joined property on the feature)
