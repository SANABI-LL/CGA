import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({})
const BUCKET = process.env.GEODATA_BUCKET ?? process.env.GEOJSON_BUCKET ?? 'campusgeo-geodata-491117467175'

export interface SessionTurn {
  query: string
  toolsUsed: string[]
  featureCount: number
  summary: string
}

export async function getSessionHistory(sessionId: string): Promise<SessionTurn[]> {
  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `sessions/${sessionId}.json` })
    )
    const body = await result.Body!.transformToString()
    return JSON.parse(body) as SessionTurn[]
  } catch {
    return []
  }
}

export async function appendSessionTurn(sessionId: string, turn: SessionTurn): Promise<void> {
  const existing = await getSessionHistory(sessionId)
  const turns = [...existing, turn].slice(-5)
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `sessions/${sessionId}.json`,
        Body: JSON.stringify(turns),
        ContentType: 'application/json',
      })
    )
  } catch (err) {
    console.warn('[session] append failed:', err)
  }
}
