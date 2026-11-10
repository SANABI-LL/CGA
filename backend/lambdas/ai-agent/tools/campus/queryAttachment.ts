import { z } from 'zod'
import type { TableAttachment } from './attachmentStore'

export const QueryAttachmentInputSchema = z.object({
  filter: z.object({
    field: z.string().describe('Column name from the attachment — any original header, case-insensitive, e.g. "Primary Assigned", "year", "status"'),
    op: z.enum(['=', '!=', '>', '<', 'contains', 'in']),
    value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
  }).optional(),
  groupBy: z.string().optional().describe('Group rows by this column and return distinct value counts — use to discover what values exist before filtering'),
  limit: z.number().max(2000).optional().describe('Max rows to return (default: all matches)'),
}).strict()

export type QueryAttachmentInput = z.infer<typeof QueryAttachmentInputSchema>

// Resolve a field name case-insensitively against the actual record keys.
// Returns the canonical key if found, or null.
function resolveField(records: Record<string, unknown>[], field: string): string | null {
  if (!records.length) return null
  const lower = field.toLowerCase()
  const key = Object.keys(records[0]).find((k) => k.toLowerCase() === lower)
  return key ?? null
}

// Collect distinct values of a field across all records (for fuzzy-match hints).
function distinctValues(records: Record<string, unknown>[], canonicalField: string): string[] {
  const seen = new Set<string>()
  for (const row of records) {
    const v = row[canonicalField]
    if (v !== undefined && v !== null && v !== '') seen.add(String(v))
  }
  return [...seen].sort()
}

function applyFilter(
  records: Record<string, unknown>[],
  filter: NonNullable<QueryAttachmentInput['filter']>,
  canonicalField: string
): Record<string, unknown>[] {
  const { op, value } = filter
  return records.filter((row) => {
    const raw = row[canonicalField]
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
  const { records } = attachment

  // Resolve groupBy field (case-insensitive)
  let groupByKey: string | null = null
  if (input.groupBy) {
    groupByKey = resolveField(records, input.groupBy) ?? input.groupBy
  }

  let rows = records

  if (input.filter) {
    const canonicalField = resolveField(records, input.filter.field)
    if (!canonicalField) {
      // Field not found — return available column names so the model can pick the right one
      return {
        error: `Column "${input.filter.field}" not found in attachment.`,
        availableColumns: attachment.columns,
        totalRows: 0,
        ids: [],
      }
    }

    rows = applyFilter(records, input.filter, canonicalField)

    // Zero matches: return distinct values of the filtered field so the model
    // can identify the closest matching value (e.g. "CREO" → "Commerical Real Estate (CRE)").
    if (rows.length === 0) {
      return {
        totalRows: 0,
        ids: [],
        hint: `No rows matched. Distinct values in "${canonicalField}" (${attachment.rows} rows total):`,
        distinctValues: distinctValues(records, canonicalField),
      }
    }
  }

  if (groupByKey) {
    const groups: Record<string, number> = {}
    for (const row of rows) {
      const key = String(row[groupByKey] ?? '(unknown)')
      groups[key] = (groups[key] ?? 0) + 1
    }
    const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1])
    return {
      groupBy: groupByKey,
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
