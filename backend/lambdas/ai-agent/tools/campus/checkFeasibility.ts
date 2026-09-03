import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'
import { pickBuildingProps } from './buildingFields'
import { searchDocuments } from './searchDocuments'

// ── constants ────────────────────────────────────────────────────────────────

const FT_PER_FLOOR_ESTIMATE = 14  // standard academic building floor-to-floor
const SQ_FT_PER_ACRE = 43_560

// CHRS rules are pure table lookups — no model involvement.
// Demolition/alteration review is triggered by §13-32-230 at Orange and Red.
const CHRS_RULES: Record<string, { status: 'pass' | 'review' | 'fail'; detail: string }> = {
  RED: {
    status: 'review',
    detail:
      'CHRS Red (Chicago Landmark). Any significant exterior alteration or demolition requires full Landmarks Commission review and approval. Demolition is effectively prohibited for landmark structures.',
  },
  ORANGE: {
    status: 'review',
    detail:
      'CHRS Orange (potentially significant). Exterior alteration or demolition triggers §13-32-230 review — pre-application consultation with the City is required before proceeding.',
  },
  BLUE: {
    status: 'pass',
    detail:
      'CHRS Blue. No automatic §13-32-230 review trigger for this rating. Exterior changes may require institutional appearance review.',
  },
  YELLOW: {
    status: 'pass',
    detail: 'CHRS Yellow. No §13-32-230 review trigger for typical alterations.',
  },
  GREEN: {
    status: 'pass',
    detail: 'CHRS Green. No historic-resource constraints on typical alterations.',
  },
  PURPLE: {
    status: 'pass',
    detail: 'CHRS Purple. No automatic §13-32-230 review trigger.',
  },
}

// ── schemas ──────────────────────────────────────────────────────────────────

export const CheckFeasibilityInputSchema = z
  .object({
    buildingName: z
      .string()
      .min(2)
      .max(200)
      .describe('Target building name or code, e.g. "Kent Chemical Laboratory", "C37"'),
    proposal: z.object({
      addedFloors: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe('Number of floors to add vertically'),
      addedFootprintSf: z
        .number()
        .min(0)
        .optional()
        .describe(
          'If the addition also expands the building footprint, provide the expansion area in sq ft. Omit for a pure vertical addition.'
        ),
      side: z
        .enum(['north', 'south', 'east', 'west'])
        .optional()
        .describe('Side of the building where the addition is proposed'),
    }),
  })
  .strict()

export type CheckFeasibilityInput = z.infer<typeof CheckFeasibilityInputSchema>

type ConstraintStatus = 'pass' | 'review' | 'fail'

interface Constraint {
  label: string
  status: ConstraintStatus
  detail: string
  citation: string
}

// ── name normalisation (mirrors getBuilding.ts) ───────────────────────────────

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(
      /\b(the|a|an|of|and|hall|laboratory|lab|building|center|house|chapel|institute|school)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim()
}

// ── geometry helpers ──────────────────────────────────────────────────────────

type Ring = number[][]

/**
 * Shoelace formula in geographic coordinates, then scaled to sq ft.
 * Accurate for small polygons (building footprints) near lat 41.8°N.
 * Used only when Area_AC is unavailable.
 */
function polygonAreaSqFt(ring: Ring): number {
  // At latitude ~41.8°: 1° lat ≈ 364 773 ft, 1° lng ≈ 272 100 ft
  const LAT_FT = 364_773
  const LNG_FT = 272_100
  let area = 0
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
  }
  return Math.abs(area / 2) * LNG_FT * LAT_FT
}

function extractFootprintPolygon(
  geometry: Record<string, unknown> | null
): { ring: Ring; type: 'Polygon' } | null {
  if (!geometry) return null
  const t = geometry.type as string
  const coords = geometry.coordinates as unknown
  if (t === 'Polygon' && Array.isArray(coords) && Array.isArray((coords as Ring[])[0])) {
    return { ring: (coords as Ring[])[0], type: 'Polygon' }
  }
  if (t === 'MultiPolygon' && Array.isArray(coords)) {
    const first = (coords as Ring[][])[0]
    if (Array.isArray(first) && Array.isArray(first[0])) return { ring: first[0], type: 'Polygon' }
  }
  return null
}

// ── main ─────────────────────────────────────────────────────────────────────

/**
 * Building addition/alteration feasibility check.
 *
 * Combines three data sources that no single GIS query can handle alone:
 *   1. Building geometry attributes (CHRS, FAR inputs, height)
 *   2. Chicago historic-resource rules (§13-32-230) — pure code lookup
 *   3. PD 43 planning document passages (semantic search for FAR limits, permitted uses)
 *
 * FAR arithmetic is computed in code; the model interprets PD 43 passages for
 * the FAR limit and any special conditions. Never trust the model to do arithmetic.
 */
export async function checkFeasibility(input: CheckFeasibilityInput) {
  // ── 1. Find building ───────────────────────────────────────────────────────
  const layerResult = await queryS3Layer({
    layerName: 'buildings',
    maxResults: 500,
    returnGeometry: true,
  })
  if ('error' in layerResult) return { error: 'Buildings layer unavailable.' }

  const needle = normalizeName(input.buildingName)
  const match = layerResult.features.find((f) => {
    const p = f.properties as Record<string, unknown>
    // Code match
    if (
      [p.BD_ID, p.Building_Code].some(
        (v) => typeof v === 'string' && v.trim().toLowerCase() === input.buildingName.trim().toLowerCase()
      )
    )
      return true
    // Name match
    return [p.DISCRIPT1, p.OtherNames, p.Facility_Name, p.DISCRIPT2].some(
      (v) => typeof v === 'string' && normalizeName(v).includes(needle)
    )
  })

  if (!match) {
    return {
      error: `Building not found: "${input.buildingName}". Try get_building to check the exact name first.`,
    }
  }

  const props = match.properties as Record<string, unknown>
  const buildingName = String(props.DISCRIPT1 ?? input.buildingName)
  const chrs = props.CHRS ? String(props.CHRS).toUpperCase().trim() : null
  const subArea = props.SubArea ? String(props.SubArea).trim() : null
  const grossAreaSf = typeof props.Gross_Area_SF === 'number' ? props.Gross_Area_SF : null
  const areaAc = typeof props.Area_AC === 'number' ? props.Area_AC : null
  const bldgHgt = typeof props.BLDG_HGT === 'number' ? props.BLDG_HGT : null

  // ── 2. FAR calculation (code only, no model) ───────────────────────────────
  const geomData = extractFootprintPolygon(match.geometry as Record<string, unknown> | null)

  // Lot area: prefer Area_AC; fall back to geometry-derived footprint area
  const lotAreaSf: number | null = areaAc
    ? Math.round(areaAc * SQ_FT_PER_ACRE)
    : geomData
    ? Math.round(polygonAreaSqFt(geomData.ring))
    : null

  const lotAreaSource = areaAc ? 'Area_AC field' : geomData ? 'footprint geometry' : 'unavailable'

  let currentFAR: number | null = null
  let projectedFAR: number | null = null
  let addedGFA: number | null = null
  let estimatedFloors: number | null = null
  let footprintPerFloorSf: number | null = null

  if (grossAreaSf && lotAreaSf) {
    currentFAR = Math.round((grossAreaSf / lotAreaSf) * 100) / 100

    if (input.proposal.addedFloors) {
      estimatedFloors = bldgHgt
        ? Math.max(1, Math.round(bldgHgt / FT_PER_FLOOR_ESTIMATE))
        : null
      footprintPerFloorSf =
        estimatedFloors && grossAreaSf ? Math.round(grossAreaSf / estimatedFloors) : null

      // Footprint of addition: explicit input > per-floor estimate > full lot area
      const additionFloorplate =
        input.proposal.addedFootprintSf ?? footprintPerFloorSf ?? lotAreaSf
      addedGFA = Math.round(additionFloorplate * input.proposal.addedFloors)
      projectedFAR =
        Math.round(((grossAreaSf + addedGFA) / lotAreaSf) * 100) / 100
    }
  }

  // ── 3. CHRS constraint (pure table lookup) ─────────────────────────────────
  const chrsEntry = chrs
    ? (CHRS_RULES[chrs] ?? {
        status: 'review' as ConstraintStatus,
        detail: `CHRS ${chrs} — consult the historic preservation office for applicable review requirements.`,
      })
    : { status: 'pass' as ConstraintStatus, detail: 'No CHRS rating on record.' }

  const chrsConstraint: Constraint = {
    label: 'Historic resource rating',
    status: chrsEntry.status,
    detail: chrsEntry.detail,
    citation: 'Chicago Zoning Ordinance §13-32-230; CHRS Survey',
  }

  // ── 4. FAR constraint (numbers in code; limit from PD 43 passages) ─────────
  let farDetail: string
  if (!grossAreaSf || !lotAreaSf) {
    farDetail = 'GFA or lot area not available — FAR cannot be calculated. Review PD 43 subarea plan for applicable limit.'
  } else if (!input.proposal.addedFloors) {
    farDetail = `Current GFA ${grossAreaSf.toLocaleString()} sf, lot area ~${lotAreaSf.toLocaleString()} sf (from ${lotAreaSource}), current FAR ${currentFAR}. No floor count in proposal — FAR impact not calculated.`
  } else {
    farDetail =
      `Current GFA ${grossAreaSf.toLocaleString()} sf, lot area ~${lotAreaSf.toLocaleString()} sf (from ${lotAreaSource}). ` +
      `Current FAR: ${currentFAR}. ` +
      `Proposed addition: ${input.proposal.addedFloors} floor${input.proposal.addedFloors > 1 ? 's' : ''}` +
      (input.proposal.side ? ` on ${input.proposal.side} side` : '') +
      `, ~${addedGFA?.toLocaleString()} sf added GFA. Projected FAR: ${projectedFAR}. ` +
      `FAR limit for Subarea ${subArea ?? '—'} is in PD 43 — see planning passages.`
  }

  const farConstraint: Constraint = {
    label: 'Floor area ratio',
    status: 'review',
    detail: farDetail,
    citation: `PD 43; Subarea ${subArea ?? '—'} Plan`,
  }

  // ── 5. PD 43 passages ─────────────────────────────────────────────────────
  const docQuery = subArea
    ? `subarea ${subArea} floor area ratio permitted uses special conditions commitment`
    : `campus building addition floor area ratio permitted uses`

  const docsResult = await searchDocuments({ query: docQuery, topK: 5 })
  const passages = 'passages' in docsResult ? docsResult.passages : []

  // ── 6. Derive overall verdict ──────────────────────────────────────────────
  const constraints: Constraint[] = [chrsConstraint, farConstraint]
  const hasFailure = constraints.some((c) => c.status === 'fail')
  const hasReview = constraints.some((c) => c.status === 'review')
  const verdictLevel: ConstraintStatus = hasFailure ? 'fail' : hasReview ? 'review' : 'pass'
  const verdict = hasFailure
    ? 'Not feasible'
    : hasReview
    ? 'Feasible, with conditions'
    : 'Feasible'

  const subject = [
    buildingName,
    subArea ? `Subarea ${subArea}` : null,
    chrs ? `CHRS ${chrs.charAt(0) + chrs.slice(1).toLowerCase()}` : 'No CHRS rating',
  ]
    .filter(Boolean)
    .join(' · ')

  // ── 7. Geometry for the 3D viewer ──────────────────────────────────────────
  const geometryOut =
    geomData && bldgHgt
      ? {
          baseHeightFt: bldgHgt,
          footprint: { type: 'Polygon' as const, coordinates: [geomData.ring] },
        }
      : null

  return {
    // Frontend ruling card — emitted via SSE 'ruling' field in the tool_result event
    ruling: {
      verdict,
      verdictLevel,
      subject,
      constraints,
      geometry: geometryOut,
    },
    // Map: show only the target building
    features: {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: match.geometry,
          properties: pickBuildingProps(props),
        },
      ],
    },
    // Model-only payload — geometry stripped, planning passages for LLM interpretation
    _modelSummary: {
      building: buildingName,
      subArea,
      chrs,
      grossAreaSf,
      lotAreaSf,
      lotAreaSource,
      currentFAR,
      projectedFAR,
      addedGFA,
      estimatedExistingFloors: estimatedFloors,
      verdict,
      verdictLevel,
      constraints: constraints.map((c) => ({ label: c.label, status: c.status })),
      planningPassages: (passages ?? []).slice(0, 5),
      note:
        'FAR numbers and CHRS status pre-computed in code — do not recalculate. ' +
        'Use planningPassages to interpret FAR limit for this subarea and explain any special conditions. ' +
        'If passages contain a specific FAR limit, compare projectedFAR against it and refine your answer. ' +
        'Map shows only the target building.',
    },
  }
}
