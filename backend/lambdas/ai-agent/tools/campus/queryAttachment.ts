import { z } from 'zod'
import type { TableAttachment } from './attachmentStore'

export const QueryAttachmentInputSchema = z.object({
  filter: z.object({
    field: z.string().describe('Column name from the attachment, e.g. "year", "status", "use"'),
    op: z.enum(['=', '!=', '>', '<', 'contains', 'in']),
    value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
  }).optional(),
  groupBy: z.string().optional().describe('Group rows by this column and return counts'),
  limit: z.number().max(2000).optional().describe('Max rows to return (default: all matches)'),
}).strict()

export type QueryAttachmentInput = z.infer<typeof QueryAttachmentInputSchema>

function applyFilter(
  records: Record<string, unknown>[],
  filter: NonNullable<QueryAttachmentInput['filter']>
): Record<string, unknown>[] {
  const { field, op, value } = filter
  return records.filter((row) => {
    const raw = row[field]
    // Missing values never match any comparison
    if (raw === undefined || raw === null || raw === '') return false
    switch (op) {
      case '=':
        return String(raw).toLowerCase() === String(value).toLowerCase()
      case '!=':
        return String(raw).toLowerCase() !== String(value).toLowerCase()
      case '>': {
        const n = Number(raw); return !Number.isNaN(n) && n > Number(value)
      }
      case '<': {
        const n = Number(raw); return !Number.isNaN(n) && n < Number(value)
      }
      case 'contains':
        return String(raw).toLowerCase().includes(String(value).toLowerCase())
      case 'in': {
        const vals = (Array.isArray(value) ? value : [value]).map(String)
        return vals.some((v) => String(raw).toLowerCase() === v.toLowerCase())
      }
      default:
        return false
    }
  })
}

export function queryAttachment(attachment: TableAttachment, input: QueryAttachmentInput) {
  let rows = input.filter ? applyFilter(attachment.records, input.filter) : attachment.records

  if (input.groupBy) {
    const groups: Record<string, number> = {}
    for (const row of rows) {
      const key = String(row[input.groupBy] ?? '(unknown)')
      groups[key] = (groups[key] ?? 0) + 1
    }
    const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1])
    return {
      groupBy: input.groupBy,
      groups: sorted.map(([value, count]) => ({ value, count })),
      totalRows: rows.length,
      ids: rows.map((r) => String(r.id ?? '')).filter(Boolean),
    }
  }

  if (input.limit) rows = rows.slice(0, input.limit)

  return {
    rows,
    totalRows: rows.length,
    ids: rows.map((r) => String(r.id ?? '')).filter(Boolean),
  }
}
