/**
 * Allow-list for building-layer properties that may leave the backend.
 *
 * The buildings GeoJSON carries internal facilities columns beyond the
 * intended public set; tools must never spread raw feature properties into
 * responses. Anything not listed here (or added by the tools themselves,
 * e.g. distanceMeters) is stripped before features are returned.
 */
// Every entry below is verified to exist in layers/buildings.geojson —
// no inferred/invented column names (that broke building lookups once).
export const BUILDING_FIELD_ALLOWLIST: ReadonlySet<string> = new Set([
  // identity / descriptive
  'BD_ID', 'Building_Code', 'DISCRIPT1', 'DISCRIPT2', 'OtherNames',
  'ADDRESS', 'PROPERTY_S',
  // metrics — current snapshot
  'RI_23', 'FCI_23', 'BLDG_HGT', 'Area_AC',
  'Gross_Area_SF', 'Year_Opened', 'Year_Completed',
  // metrics — FCI/RI from 2026 join (cleaned names)
  'FCI', 'FCI_Cost', 'RI', 'RI_Cost_Total', 'Replacement',
  // metrics — 10-year capital forecast (2026-2035)
  'F2026', 'F2027', 'F2028', 'F2029', 'F2030',
  'F2031', 'F2032', 'F2033', 'F2034', 'F2035',
  // narrative
  'Architects', 'Heritage', 'Notes',
  // historic-resource ratings
  'CHRS',
  // planning geography — written by join_subarea_to_buildings.py ETL
  'SubArea',
])

export function pickBuildingProps(
  props: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(props)) {
    if (BUILDING_FIELD_ALLOWLIST.has(key)) out[key] = props[key]
  }
  return { ...out, ...extra }
}
