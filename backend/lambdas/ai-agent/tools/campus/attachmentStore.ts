// In-memory attachment store, keyed by sessionId. SIMS exports contain PINs
// and legal descriptions — never write to S3, never log the content.

export interface TableAttachment {
  kind: 'table'
  name: string
  rows: number
  columns: string[]
  idColumn: string
  buildingIds: string[]
  records: Record<string, unknown>[]
}

export interface DocumentAttachment {
  kind: 'document'
  name: string
  pages: number
  text: string
  truncated: boolean
}

export type Attachment = TableAttachment | DocumentAttachment

const store = new Map<string, { attachment: Attachment; expiresAt: number }>()
const TTL_MS = 60 * 60 * 1000

export function storeAttachment(sessionId: string, attachment: Attachment): void {
  const now = Date.now()
  store.set(sessionId, { attachment, expiresAt: now + TTL_MS })
  for (const [key, val] of store) {
    if (val.expiresAt < now) store.delete(key)
  }
}

export function getAttachment(sessionId: string): Attachment | null {
  const entry = store.get(sessionId)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) { store.delete(sessionId); return null }
  return entry.attachment
}
