/**
 * Clean and reproject buildings.geojson for S3 deployment.
 *
 * Input:  Raw ArcGIS export with table-prefixed field names + EPSG:3435 coords
 * Output: Clean field names + WGS84 (EPSG:4326) coordinates
 *
 * Usage: node scripts/clean-buildings.mjs [input.geojson] [output.geojson]
 *        Defaults: input = AppData/Local/Temp/buildings_new.geojson
 *                  output = gis_output/buildings.geojson
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DEFAULT_INPUT = join(process.env.LOCALAPPDATA || '', 'Temp', 'buildings_new.geojson')
const DEFAULT_OUTPUT = join(ROOT, 'gis_output', 'buildings.geojson')

const inputPath = process.argv[2] || DEFAULT_INPUT
const outputPath = process.argv[3] || DEFAULT_OUTPUT

// ── EPSG:3435 (IL State Plane East, US Survey Feet) → WGS84 ──────────────
// NAD83 State Plane Illinois East (FIPS 1201) in US survey feet.
// Parameters from EPSG registry:
const A = 6378137.0                    // GRS80 semi-major axis (meters)
const F = 1 / 298.257222101            // GRS80 flattening
const E2 = 2 * F - F * F              // eccentricity squared
const E = Math.sqrt(E2)

// Transverse Mercator parameters for IL East (NAD83)
const LAT0 = 36.66666666667 * Math.PI / 180   // latitude of origin
const LON0 = -88.33333333333 * Math.PI / 180  // central meridian
const K0 = 0.999975                            // scale factor
const FE = 300000.0                            // false easting (meters)
const FN = 0.0                                 // false northing (meters)
const FT_TO_M = 0.3048006096012192            // US survey foot → meters

// Meridian arc from equator to latitude of origin
const M0 = A * ((1 - E2/4 - 3*E2*E2/64 - 5*E2*E2*E2/256) * LAT0
  - (3*E2/8 + 3*E2*E2/32 + 45*E2*E2*E2/1024) * Math.sin(2*LAT0)
  + (15*E2*E2/256 + 45*E2*E2*E2/1024) * Math.sin(4*LAT0)
  - (35*E2*E2*E2/3072) * Math.sin(6*LAT0))

function statePlaneToWGS84(easting_ft, northing_ft) {
  const x = easting_ft * FT_TO_M - FE
  const y = northing_ft * FT_TO_M - FN

  // Inverse Transverse Mercator (iterative footpoint latitude)
  const M = M0 + y / K0
  const mu = M / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 * E2 * E2 / 256))

  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2))
  const phi1 = mu +
    (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu) +
    (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu) +
    (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu) +
    (1097 * e1 * e1 * e1 * e1 / 512) * Math.sin(8 * mu)

  const sinPhi1 = Math.sin(phi1)
  const cosPhi1 = Math.cos(phi1)
  const tanPhi1 = sinPhi1 / cosPhi1
  const N1 = A / Math.sqrt(1 - E2 * sinPhi1 * sinPhi1)
  const T1 = tanPhi1 * tanPhi1
  const C1 = (E2 / (1 - E2)) * cosPhi1 * cosPhi1
  const R1 = A * (1 - E2) / Math.pow(1 - E2 * sinPhi1 * sinPhi1, 1.5)
  const D = x / (N1 * K0)

  const lat = phi1 -
    (N1 * tanPhi1 / R1) * (
      D * D / 2 -
      (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * (E2 / (1 - E2))) * D * D * D * D / 24 +
      (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * (E2 / (1 - E2)) - 3 * C1 * C1) * D * D * D * D * D * D / 720
    )

  const lon = LON0 + (
    D -
    (1 + 2 * T1 + C1) * D * D * D / 6 +
    (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * (E2 / (1 - E2)) + 24 * T1 * T1) * D * D * D * D * D / 120
  ) / cosPhi1

  return [lon * 180 / Math.PI, lat * 180 / Math.PI]
}

// ── Field name cleaning ──────────────────────────────────────────────────
// Strip table prefix, clean up ugly names from FCI join
const FIELD_RENAMES = {
  'FCI__': 'FCI',
  'FCI_COST__Current_Deficiencies_': 'FCI_Cost',
  'Gross_Area__s_f__': 'Gross_Area_SF',
  'RI_': 'RI',
  'RI_COST_Total': 'RI_Cost_Total',
  'hape_Leng': 'Shape_Length_legacy',
  'HVAC_Controls_Type__DDC__Pneum_': 'HVAC_Controls_Type',
  'T_Sheet_1___F2020': 'T_Sheet_F2020',
}

// Fields to drop (redundant join keys or internal IDs)
const DROP_FIELDS = new Set([
  'ObjectID',     // FCI join internal ID (we keep OBJECTID and OBJECT_ID from main table)
  'Facility_Name', // duplicate of DISCRIPT1
  'Building_Code', // duplicate from FCI join (same as BD_ID or Building_Code in main)
])

function cleanFieldName(raw) {
  // Strip table prefix
  const dot = raw.indexOf('.')
  const name = dot > 0 ? raw.slice(dot + 1) : raw
  // Apply renames
  return FIELD_RENAMES[name] || name
}

// ── Transform coordinates recursively ────────────────────────────────────
function transformCoords(coords) {
  if (typeof coords[0] === 'number') {
    return statePlaneToWGS84(coords[0], coords[1])
  }
  return coords.map(transformCoords)
}

// ── Main ─────────────────────────────────────────────────────────────────
console.log(`[clean-buildings] Reading ${inputPath}`)
const raw = JSON.parse(readFileSync(inputPath, 'utf8'))
console.log(`  ${raw.features.length} features, CRS: ${raw.crs?.properties?.name || 'unknown'}`)

// Auto-detect if coordinates are already WGS84 (lng/lat range) or State Plane (large numbers)
function detectCRS(features) {
  const f0 = features[0]
  if (!f0 || !f0.geometry) return 'unknown'
  let pt
  if (f0.geometry.type === 'Polygon') pt = f0.geometry.coordinates[0][0]
  else if (f0.geometry.type === 'MultiPolygon') pt = f0.geometry.coordinates[0][0][0]
  else if (f0.geometry.type === 'Point') pt = f0.geometry.coordinates
  if (!pt) return 'unknown'
  // WGS84 Chicago area: lng ~ -87.6, lat ~ 41.8
  if (pt[0] > -180 && pt[0] < 180 && pt[1] > -90 && pt[1] < 90) return 'wgs84'
  // EPSG:3435 IL State Plane East (US feet): easting ~ 1,100,000–1,200,000, northing ~ 1,800,000–1,900,000
  if (pt[0] > 500000 && pt[1] > 500000) return 'epsg3435'
  return 'unknown'
}

const detectedCRS = detectCRS(raw.features)
const needsReproject = detectedCRS === 'epsg3435'
console.log(`  Detected CRS: ${detectedCRS}${needsReproject ? ' → will reproject to WGS84' : ' → no reprojection needed'}`)

const cleanFeatures = raw.features.map((f, i) => {
  // Clean properties
  const props = {}
  // Track which main-table Building_Code we've seen
  let mainBuildingCode = null
  for (const [key, value] of Object.entries(f.properties)) {
    const dot = key.indexOf('.')
    const prefix = dot > 0 ? key.slice(0, dot) : ''
    const baseName = dot > 0 ? key.slice(dot + 1) : key

    // Drop redundant FCI join fields
    if (prefix.includes('FCI_RI_Data') && DROP_FIELDS.has(baseName)) continue

    const cleanName = cleanFieldName(key)

    // Deduplicate Building_Code: keep main table's version
    if (cleanName === 'Building_Code') {
      if (prefix.includes('FCI_RI_Data')) continue // skip join's Building_Code
      mainBuildingCode = value
    }

    props[cleanName] = value
  }

  // Transform geometry (only reproject if needed)
  const geometry = f.geometry ? {
    type: f.geometry.type,
    coordinates: needsReproject ? transformCoords(f.geometry.coordinates) : f.geometry.coordinates,
  } : null

  return { type: 'Feature', properties: props, geometry }
})

const output = {
  type: 'FeatureCollection',
  features: cleanFeatures,
}

// Validate a sample point is in Chicago area
const sample = cleanFeatures[0].geometry.coordinates[0][0]
const inChicago = sample[0] > -88 && sample[0] < -87 && sample[1] > 41.5 && sample[1] < 42.5
if (!inChicago) {
  console.error(`  ERROR: Sample coord ${sample} not in Chicago area! Projection may be wrong.`)
  process.exit(1)
}

mkdirSync(join(ROOT, 'gis_output'), { recursive: true })
writeFileSync(outputPath, JSON.stringify(output))

const sizeMB = (Buffer.byteLength(JSON.stringify(output)) / 1024 / 1024).toFixed(2)
console.log(`  ✓ ${needsReproject ? 'Reprojected EPSG:3435 → WGS84' : 'Coordinates already WGS84 (passed through)'}`)
console.log(`  ✓ Cleaned field names (stripped table prefixes)`)
console.log(`  ✓ Merged FCI/RI 2026-2035 forecast data`)
console.log(`  ✓ ${cleanFeatures.length} features, ${Object.keys(cleanFeatures[0].properties).length} fields`)
console.log(`  ✓ Written to ${outputPath} (${sizeMB} MB)`)
console.log(`\n  Sample coord: [${sample[0].toFixed(6)}, ${sample[1].toFixed(6)}]`)

// Show final field list
const allFields = new Set()
cleanFeatures.forEach(f => Object.keys(f.properties).forEach(k => allFields.add(k)))
console.log(`\n  Fields (${allFields.size}):`)
;[...allFields].sort().forEach(k => console.log(`    ${k}`))
