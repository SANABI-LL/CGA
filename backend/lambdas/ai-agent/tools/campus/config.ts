/**
 * Shared runtime config for the campus tools.
 *
 * The GeoJSON bucket must come from the environment — no hardcoded default,
 * so the account-id-bearing bucket name never ships in the bundle. Called
 * lazily at query time (not module load) so a missing variable surfaces as a
 * per-tool error instead of crashing the whole Lambda on cold start.
 */
export function getBucket(): string {
  const bucket = process.env.GEOJSON_BUCKET
  if (!bucket) throw new Error('GEOJSON_BUCKET environment variable is not configured')
  return bucket
}
