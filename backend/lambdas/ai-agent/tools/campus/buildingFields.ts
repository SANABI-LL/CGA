/**
 * Allow-list for building-layer properties that may leave the backend.
 *
 * The buildings GeoJSON carries internal facilities columns beyond the
 * intended public set; tools must never spread raw feature properties into
 * responses. Anything not listed here (or added by the tools themselves,
 * e.g. distanceMeters) is stripped before features are returned.
 */
export const BUILDING_FIELD_ALLOWLIST: ReadonlySet<string> = new Set([
  // identity / descriptive
  'BD_ID', 'DISCRIPT1', 'DISCRIPT2', 'ADDRESS', 'PROPERTY_S',
  'BLDG_NAME', 'BLDG_NUM', 'BLDG_USE', 'USE_TYPE', 'NAME', 'ADDR',
  // metrics intentionally exposed (RI / FCI / height / year / area)
  'RI_23', 'RI_', 'RI', 'FCI__', 'FCI', 'BLDG_HGT', 'Area_AC',
  'Year_Opened', 'YearOpened', 'Year_Completed', 'YEAR_BUILT',
  'FLOORS', 'NUM_FLOORS', 'SQ_FEET', 'SQFT', 'ACCESSIBLE', 'ADA',
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
