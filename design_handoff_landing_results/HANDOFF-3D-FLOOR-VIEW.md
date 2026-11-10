# Handoff: 3D floor view (Crerar A06), October 15, 2026

The reference implementation is `Landing B v2 Night Survey.dc.html` in this folder. Rebuild the behaviour below in the repo's front end. Values (sizes, colours, timings) are final. Use them exactly.

## Entering 3D
- The floor plan toolbar has a **3D / Flat** toggle next to the floor tabs. There is no Apart/Stacked control.
- On entering 3D, load `{bdId}/{floor}.rooms.geojson` and `{bdId}/{floor}.gross.geojson` for every floor in `plans/index.json`. Cache them.
- Hide the 2D plan layers, plus every other 3D layer on the map (`results-3d`, `results-3d-proposed`, `context-3d`). Restore all of them on Flat.
- Ease the camera to pitch 58, bearing −28, framed to the building outline.

## What is drawn
**Only the selected floor is drawn.** MapLibre composites each fill-extrusion layer separately, with no depth shared between layers, so any other floor in the scene paints over the selected one. Do not draw floors above or below at reduced opacity.

The selected floor uses a single `fill-extrusion` source. Each feature carries `kind`, `lvl` (its index in the floor list) and `floor`. Base height is `lvl × 9 m` plus the offsets below:

| kind | from | to | colour (light / dark) |
|---|---|---|---|
| `slab`: the gross outline, i.e. the floor plate | 0 | 0.22 m | `#EFE9DF` / `#2A1A1D` |
| `room`: the room polygon | 0.22 | 0.30 m | space-type colour blended 40% (light) or 62% (dark) into the slab colour; circulation spaces use `#E3DCD0` / `#3A2A2D` |
| `wall`: every edge of every room, as a 0.16 m wide quad; shared edges drawn once | 0.22 | 1.45 m | `#FFFDF8` / `#8E7D7F` |
| `ext`: the gross outline edges, as 0.45 m wide quads | 0 | 2.1 m | `#CFC5B6` / `#A4928F` |

Build wall quads counter-clockwise, and extend each one by half its thickness at both ends so the corners close. Skip edges shorter than 0.15 m.

Light: `{ anchor: 'viewport', intensity: 0.5, position: [1.2, 210, 42] }`. Set `fill-extrusion-vertical-gradient: true`.

## Furniture (selected floor only)
- Take the linework features with `cls === 'furniture'`.
- A closed outline with an area between 0.08 and 30 m² becomes a solid block from 0.30 to 1.05 m (`#D6CCBD` / `#76656A`).
- Everything else becomes 0.05 m strips from 0.30 to 1.00 m (`#BFB4A4` / `#8E7D80`).
- Cap at 30,000 features. Keep the solid blocks first and drop strips first.
- Rebuild when the selected floor changes.

## Selection
- Clicking a room selects it. This also applies to every room returned by a `find_room` match. The view stays in 3D.
- The selected room keeps its height and its full, unblended space-type colour. An amber outline is drawn around it: 0.24 m quads from 0.22 to 1.6 m, `#C4903A` / `#D9A54E`. Build it from the room's own edges, without the shared-wall dedupe, so it forms a closed loop.
- Everything else fades:
  - Other rooms: blended to 12% (light) or 20% (dark).
  - Walls: `#F6F2EA` / `#5E4E51`.
  - Exterior walls: `#E2DACE` / `#6E5D60`.
  - Furniture: solid blocks `#E6DFD3` / `#55464A`, strips `#DCD3C5` / `#5E4E51`.
- Ignore the 2D map's global click handler while in 3D. It would otherwise reopen the flat plan.

## Room info and legend
- The hover card and the pinned room card sit in the **top-right** of the map, 236 px wide. Only one card shows at a time: the hover card wins while the pointer is over a different room.
- The space-type legend sits **bottom-left**. Legend labels do not wrap.

## Idle spin
- The view rotates at 0.0025° per ms, about 2.5° per second, capped at a 50 ms step.
- Any `mousedown`, `touchstart`, `wheel`, `mousemove` or `dragstart` pauses the spin. It resumes after 4 s of no input.
- No spin under `prefers-reduced-motion`.

## Repaint
- Floor switching, selection, colours and furniture all run through a single `paintStack()`.
- Apply the floor filters **first**, and run each later step in its own try/catch. A single failing paint call previously left the wrong floor showing, with no highlight and no furniture.

## Leaving 3D
- If the floor changed while in 3D, reload the 2D plan for that floor, and keep the pinned room.
