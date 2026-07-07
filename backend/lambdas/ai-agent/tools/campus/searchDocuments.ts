import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'
const BUCKET = process.env.GEOJSON_BUCKET || 'campusgeo-geodata-491117467175'
const INDEX_KEY = process.env.DOCS_INDEX_KEY || 'documents/pd43_index.json'
// Overridable so the Lambda can point at an application inference profile ARN
// when its IAM policy is scoped to inference-profile/* rather than amazon.* models.
const EMBED_MODEL_ID = process.env.EMBED_MODEL_ID || 'amazon.titan-embed-text-v2:0'
// An inference-profile ARN pins the call to its own region, which may differ
// from the Lambda's region — derive it so the client signs for the right one.
const EMBED_REGION = EMBED_MODEL_ID.startsWith('arn:')
  ? EMBED_MODEL_ID.split(':')[3]
  : AWS_REGION

const s3 = new S3Client({ region: AWS_REGION })
const bedrock = new BedrockRuntimeClient({ region: EMBED_REGION })

export const SearchDocumentsInputSchema = z.object({
  query: z
    .string()
    .describe('English search phrase, e.g. "maximum floor area ratio" or "permitted uses subarea B"'),
  topK: z.number().min(1).max(10).optional().default(5),
})

export type SearchDocumentsInput = z.infer<typeof SearchDocumentsInputSchema>

interface IndexChunk {
  id: number
  doc: string
  page: number
  text: string
  embedding: number[]
}

interface DocumentIndex {
  version: number
  model: string
  dimensions: number
  corpus: string
  documents: string[]
  chunks: IndexChunk[]
}

// The index (~5MB, 386 chunks) is fetched once per Lambda instance and kept
// in module scope — same lifecycle pattern as the S3 GeoJSON layers.
let indexPromise: Promise<DocumentIndex> | null = null

function loadIndex(): Promise<DocumentIndex> {
  if (!indexPromise) {
    indexPromise = (async () => {
      const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: INDEX_KEY }))
      if (!response.Body) throw new Error(`Empty response from S3 for ${INDEX_KEY}`)
      return JSON.parse(await response.Body.transformToString()) as DocumentIndex
    })().catch((err) => {
      indexPromise = null // allow retry on next invocation
      throw err
    })
  }
  return indexPromise
}

async function embedQuery(text: string, dimensions: number): Promise<number[]> {
  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId: EMBED_MODEL_ID,
      body: JSON.stringify({ inputText: text, dimensions, normalize: true }),
    })
  )
  const parsed = JSON.parse(new TextDecoder().decode(response.body)) as { embedding: number[] }
  return parsed.embedding
}

// Both vectors are L2-normalized, so the dot product IS the cosine similarity.
function dot(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

// --- Lexical (BM25-style) fallback -----------------------------------------
// Used when the embedding model is not invocable (e.g. IAM denies Titan in
// prod). Zero model calls: pure term scoring over the indexed chunk texts.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is',
  'are', 'was', 'be', 'by', 'with', 'as', 'that', 'this', 'it', 'what',
  'which', 'how', 'many', 'much', 'does', 'do', 'about',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

interface LexicalStats {
  chunkTerms: Map<string, number>[] // per-chunk term frequencies
  chunkLens: number[]
  df: Map<string, number>
  avgLen: number
}

let lexicalStats: LexicalStats | null = null

function buildLexicalStats(index: DocumentIndex): LexicalStats {
  if (lexicalStats) return lexicalStats
  const chunkTerms: Map<string, number>[] = []
  const chunkLens: number[] = []
  const df = new Map<string, number>()
  for (const chunk of index.chunks) {
    const tf = new Map<string, number>()
    const tokens = tokenize(chunk.text)
    for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1)
    for (const tok of tf.keys()) df.set(tok, (df.get(tok) ?? 0) + 1)
    chunkTerms.push(tf)
    chunkLens.push(tokens.length)
  }
  const avgLen = chunkLens.reduce((a, b) => a + b, 0) / Math.max(1, chunkLens.length)
  lexicalStats = { chunkTerms, chunkLens, df, avgLen }
  return lexicalStats
}

function lexicalScores(index: DocumentIndex, query: string): number[] {
  const { chunkTerms, chunkLens, df, avgLen } = buildLexicalStats(index)
  const n = index.chunks.length
  const k1 = 1.2
  const b = 0.75
  const terms = tokenize(query)
  return chunkTerms.map((tf, i) => {
    let score = 0
    for (const term of terms) {
      const f = tf.get(term)
      if (!f) continue
      const d = df.get(term) ?? 0
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5))
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (chunkLens[i] / avgLen))))
    }
    return score
  })
}

/**
 * Semantic search over the PD 43 planning-document knowledge base
 * (zoning ordinance chapters, PD 43 amendments, council proceedings,
 * Woodlawn plans — text-layer PDFs indexed by ingest_documents.py).
 */
export async function searchDocuments(input: SearchDocumentsInput) {
  try {
    const index = await loadIndex()

    // Prefer semantic search; fall back to lexical scoring when the embedding
    // model is not invocable (e.g. IAM denies Titan in the prod account).
    let scores: number[]
    let retrieval: 'semantic' | 'lexical'
    try {
      const queryVector = await embedQuery(input.query, index.dimensions)
      scores = index.chunks.map((chunk) => dot(queryVector, chunk.embedding))
      retrieval = 'semantic'
    } catch (embedErr) {
      console.warn('embedding unavailable, using lexical retrieval:', embedErr)
      scores = lexicalScores(index, input.query)
      retrieval = 'lexical'
    }

    const scored = index.chunks
      .map((chunk, i) => ({ chunk, score: scores[i] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, input.topK)
      .filter(({ score }) => score > 0)

    return {
      corpus: index.corpus,
      retrieval,
      passages: scored.map(({ chunk, score }) => ({
        text: chunk.text,
        document: chunk.doc,
        page: chunk.page,
        relevance: Math.round(score * 1000) / 1000,
      })),
    }
  } catch (err) {
    return {
      error: `Document search failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
