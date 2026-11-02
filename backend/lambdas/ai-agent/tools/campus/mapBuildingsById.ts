import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'

export const MapBuildingsByIdInputSchema = z.object({
  buildingIds: z
    .array(z.string().max(50))
    .max(500)
    .optional()
    .describe('List of building IDs (BD_ID or Building_Code values from the buildings layer). Omit when fromAttachment is true — the server reads IDs from the attachment.'),
  attach: z
    .record(z.record(z.union([z.string(), z.number()])))
    .optional()
    .describe(
      'Per-building data from the user\'s spreadsheet, keyed by building ID. Values are merged into the feature properties with a "sheet_" prefix (e.g. {FCI: 0.18} becomes sheet_FCI=0.18). Known metrics (FCI, RI) are also written without prefix for frontend color-ramp compatibility. Omit when fromAttachment is true.'
    ),
  fromAttachment: z
    .boolean()
    .optional()
    .describe(
      'When true, the server reads buildingIds and all column values directly from the attached spreadsheet — do NOT also pass buildingIds or attach. Use this whenever the user attached a spreadsheet and wants to map or highlight the listed buildings.'
    ),
}).strict()

export type MapBuildingsByIdInput = z.infer<typeof MapBuildingsByIdInputSchema>

const KNOWN_METRICS = new Set(['fci', 'ri', 'ri_cost_total'])

function normalizeId(id: string): string {
  return id.trim().toLowerCase()
}

export async function mapBuildingsById(input: MapBuildingsByIdInput) {
  const ids = input.buildingIds ?? []
  if (!ids.length && !input.fromAttachment) {
    return { error: 'buildingIds is required when fromAttachment is not set' }
  }

  const raw = await queryS3Layer({
    layerName: 'buildings',
    maxResults: 600,
    returnGeometry: true,
  })
  if ('error' in raw) return raw

  const wantedIds = new Set(ids.map(normalizeId))

  // Build a lookup from the attach map (case-insensitive key)
  const attachLookup = new Map<string, Record<string, string | number>>()
  if (input.attach) {
    for (const [id, vals] of Object.entries(input.attach)) {
      attachLookup.set(normalizeId(id), vals)
    }
  }

  const matched: (typeof raw.features[number])[] = []
  const unmatchedSet = new Set(ids.map(normalizeId))

  for (const f of raw.features) {
    const bdId = normalizeId(String(f.properties?.BD_ID ?? ''))
    const bldgCode = normalizeId(String(f.properties?.Building_Code ?? ''))
    const matchKey = wantedIds.has(bdId) ? bdId : wantedIds.has(bldgCode) ? bldgCode : null
    if (!matchKey) continue

    unmatchedSet.delete(matchKey)

    const extraProps: Record<string, string | number> = {}
    const attachData = attachLookup.get(matchKey)
    if (attachData) {
      for (const [k, v] of Object.entries(attachData)) {
        // Always write sheet_<key>
        extraProps[`sheet_${k}`] = v
        // Also write bare key for known metrics so frontend color ramps work
        if (KNOWN_METRICS.has(k.toLowerCase())) {
          extraProps[k.toUpperCase()] = typeof v === 'number' ? v : parseFloat(String(v)) || v
        }
      }
    }

    matched.push({
      ...f,
      properties: { ...f.properties, ...extraProps },
    })
  }

  const unmatched = ids.filter((id) => unmatchedSet.has(normalizeId(id)))

  const features = {
    type: 'FeatureCollection' as const,
    features: matched,
  }

  const summary = {
    requested: ids.length,
    matched: matched.length,
    unmatched: unmatched.length,
    unmatchedIds: unmatched.slice(0, 20),
    hasAttachedData: !!input.attach,
    attachedFields: input.attach ? Object.keys(Object.values(input.attach)[0] ?? {}) : [],
  }

  return {
    ...summary,
    features,
    _modelSummary: summary,
  }
}
