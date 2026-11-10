import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'
import { pickBuildingProps } from './buildingFields'

export const GetBuildingInputSchema = z.object({
  name: z.string().max(200).describe('Building name or code, e.g. "Hinds Laboratory", "Regenstein Library", "C03"'),
}).strict()

export type GetBuildingInput = z.infer<typeof GetBuildingInputSchema>

type BuildingProps = Record<string, unknown>

// Strip noise words so "Hinds Lab" and "Hinds Laboratory" both hit "hinds"
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|a|an|of|and|hall|laboratory|lab|building|center|house|chapel|institute|school)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesName(props: BuildingProps, needle: string): boolean {
  const norm = normalizeName(needle)
  const candidates = [props.DISCRIPT1, props.OtherNames, props.Facility_Name, props.DISCRIPT2]
  return candidates.some((v) => typeof v === 'string' && normalizeName(v).includes(norm))
}

function matchesCode(props: BuildingProps, needle: string): boolean {
  const lc = needle.toLowerCase()
  return [props.BD_ID, props.Building_Code].some(
    (v) => typeof v === 'string' && v.trim().toLowerCase() === lc
  )
}

function bigramSimilarity(a: string, b: string): number {
  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const sa = bigrams(normalizeName(a))
  const sb = bigrams(normalizeName(b))
  let intersection = 0
  for (const g of sa) if (sb.has(g)) intersection++
  const union = sa.size + sb.size - intersection
  return union === 0 ? 0 : intersection / union
}

function yearFrom(props: BuildingProps): number | undefined {
  const completed = props.Year_Completed
  if (typeof completed === 'number' && completed > 0) return Math.round(completed)
  const opened = props.Year_Opened
  if (typeof opened === 'string' && opened.length >= 4) {
    const y = parseInt(opened.slice(0, 4), 10)
    if (!Number.isNaN(y)) return y
  }
  return undefined
}

/**
 * Single-building attribute lookup.
 *
 * Use this tool whenever the question is about ONE named building
 * ("is Hinds orange?", "when was Rockefeller Chapel built?", "what is Kent's FCI?").
 * Returns all allow-listed attributes — CHRS, FCI, RI, height, architects, etc. —
 * for the matched building(s) only, so the map shows only the relevant feature(s).
 */
export async function getBuilding(input: GetBuildingInput) {
  const needle = input.name.trim()
  if (needle.length < 2) return { error: 'Building name is too short.' }

  const result = await queryS3Layer({ layerName: 'buildings', maxResults: 500, returnGeometry: true })
  if ('error' in result) return result

  const matched = result.features
    .filter((f) => {
      const props = f.properties as BuildingProps
      return matchesCode(props, needle) || matchesName(props, needle)
    })
    .slice(0, 5)

  if (matched.length === 0) {
    const suggestions = result.features
      .map((f) => ({
        name: String((f.properties as BuildingProps).DISCRIPT1 ?? ''),
        score: bigramSimilarity(needle, String((f.properties as BuildingProps).DISCRIPT1 ?? '')),
      }))
      .filter((x) => x.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.name)
    return { found: false, query: needle, suggestions }
  }

  // Compact summary for the model — no geometry, all queryable attributes
  const buildings = matched.map((f) => {
    const p = f.properties as BuildingProps
    return {
      name: p.DISCRIPT1 ?? p.Facility_Name ?? 'Unknown',
      code: p.BD_ID ?? p.Building_Code,
      address: p.ADDRESS,
      year: yearFrom(p),
      sqft: p.Gross_Area_SF,
      heightFt: p.BLDG_HGT,
      architects: p.Architects,
      heritage: p.Heritage,
      chrs: p.CHRS,
      fci: p.FCI ?? p.FCI_23,
      ri: p.RI ?? p.RI_23,
      notes: p.Notes,
    }
  })

  return {
    query: needle,
    found: true,
    count: matched.length,
    buildings,
    features: {
      type: 'FeatureCollection' as const,
      features: matched.map((f) => ({
        ...f,
        properties: pickBuildingProps(f.properties as BuildingProps),
      })),
    },
  }
}
