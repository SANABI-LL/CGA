import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
  type Tool,
  type ContentBlock,
} from '@aws-sdk/client-bedrock-runtime'
import type { DocumentType } from '@smithy/types'
import type { SessionTurn } from './session.js'
import { getShuttleArrivals, GetShuttleArrivalsInputSchema } from './tools/campus/getShuttleArrivals'
import { getBikeStations, GetBikeStationsInputSchema } from './tools/campus/getBikeStations'
import { findCampusNearby, FindCampusNearbyInputSchema } from './tools/campus/findCampusNearby'
import { getBuildingInfo, GetBuildingInfoInputSchema } from './tools/campus/getBuildingInfo'
import { checkHours, CheckHoursInputSchema } from './tools/campus/checkHours'
import { queryTrees, QueryTreesInputSchema } from './tools/campus/queryTrees'
import { searchDocuments, SearchDocumentsInputSchema } from './tools/campus/searchDocuments'
import { queryUtilities, QueryUtilitiesInputSchema } from './tools/campus/queryUtilities'
import { queryBuildingAttributes, QueryBuildingAttributesInputSchema } from './tools/campus/queryBuildingAttributes'
import { getDataFreshness, GetDataFreshnessInputSchema } from './tools/campus/getDataFreshness'
import { findBuildingsByYear, FindBuildingsByYearInputSchema } from './tools/campus/findBuildingsByYear'
import { getCampusEvents, GetCampusEventsInputSchema } from './tools/campus/getCampusEvents'
import { getBuildingUpdates, GetBuildingUpdatesInputSchema } from './tools/campus/getBuildingUpdates'
import { queryCampusLayer, QueryCampusLayerInputSchema } from './tools/campus/queryCampusLayer'
import { getAcademicCalendar, GetAcademicCalendarInputSchema } from './tools/campus/getAcademicCalendar'

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
// BEDROCK_REGION may differ from the Lambda's own region when the model is an
// application inference profile pinned to another region (prod uses us-east-2).
const AWS_REGION = process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1'

const client = new BedrockRuntimeClient({ region: AWS_REGION })

// Tool definitions for Bedrock
const CAMPUS_TOOLS: Tool[] = [
  {
    toolSpec: {
      name: 'get_shuttle_arrivals',
      description:
        'Get real-time UChicago shuttle arrival estimates at a campus stop. Use when user asks about shuttle times, next bus, transit.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            stopName: {
              type: 'string',
              description: 'Campus shuttle stop name, e.g. "Keller Center", "Regenstein Library", "Booth School"',
            },
          },
          required: ['stopName'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_bike_stations',
      description:
        'Find Divvy bike-share stations near a campus location, with real-time availability (bikes available, docks open). Use when asked about bikes, cycling, or bike-share.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            nearLocation: { type: 'string', description: 'Campus location name, e.g. "GCIS", "Main Quad"' },
            radiusMeters: { type: 'number', default: 400 },
            limit: { type: 'number', default: 5 },
          },
          required: ['nearLocation'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'find_campus_nearby',
      description:
        'Find campus features (buildings, dining, accessible paths, bike racks, parking) within a radius of a named location. Returns sorted by distance.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            referenceLocation: { type: 'string', description: 'Named campus location, e.g. "Regenstein Library"' },
            featureType: {
              type: 'string',
              enum: ['building', 'dining', 'accessible', 'bike_rack', 'parking'],
              description: 'Type of feature to find nearby',
            },
            radiusMeters: { type: 'number', default: 300 },
            limit: { type: 'number', default: 5 },
          },
          required: ['referenceLocation', 'featureType'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_building_info',
      description:
        'Get detailed info about a specific UChicago building: address, year built/opened, gross area, height, architects, heritage status. Use when user asks about a specific building.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            buildingIdentifier: { type: 'string', description: 'Building name or building code, e.g. "Regenstein Library" or "C03"' },
          },
          required: ['buildingIdentifier'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'check_hours',
      description:
        'Check if a campus location is currently open, and when it opens/closes. ' +
        'Libraries (Regenstein, Crerar, Eckhart, Mansueto) fetch live hours from the UChicago LibCal API — accurate for holiday closures and special hours. ' +
        'Non-library locations (Ratner Athletics, Hutchinson Commons, Harper Memorial Library) use a static schedule. ' +
        'Response includes: isOpen (bool), todayHours ({open:"HH:MM",close:"HH:MM"}), renderedHours (e.g. "8am–10pm"), source ("libcal"|"static").',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            locationName: { type: 'string', description: 'Location name, e.g. "Regenstein Library", "Ratner Athletics"' },
            checkTime: { type: 'string', description: 'ISO 8601 timestamp (defaults to now)' },
          },
          required: ['locationName'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'query_trees',
      description:
        'Query the campus tree inventory. ALWAYS call this tool for tree counts — the inventory is updated regularly, never answer from memory. ' +
        'For "trees near/within X" or "trees within N ft of X": set nearLocation to the campus building or place name and radiusMeters to the converted distance (1 ft = 0.305 m, so 500 ft → 152). ' +
        'For attribute filters: species (common name, e.g. "Maple"), ageClass ("Young"/"Semi-mature"/"Mature"), condition ("Good"/"Fair"/"Poor"), minDiameter (cm), notes keyword (TreeNotes records planting batches like "2025 Fall"). ' +
        'Do NOT pass a building name to the location field — that field matches an inventory attribute tag, not a spatial lookup; it will return 0 results.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            species: { type: 'string', description: 'Tree species common name (e.g., "Maple", "Ash")' },
            ageClass: { type: 'string', description: 'Age class: "Young", "Semi-mature", or "Mature"' },
            condition: { type: 'string', description: 'Tree condition: "Good", "Fair", or "Poor"' },
            minDiameter: { type: 'number', description: 'Minimum trunk diameter in cm' },
            location: { type: 'string', description: 'Attribute-based location tag in the inventory (e.g., "Main Quad"). NOT for spatial queries.' },
            notes: { type: 'string', description: 'Keyword match on TreeNotes (planting batches, e.g. "2025 Fall")' },
            nearLocation: { type: 'string', description: 'Named campus location for spatial radius search, e.g. "Keller Center". Use for "trees near/within X" queries.' },
            radiusMeters: { type: 'number', description: 'Search radius in metres (default 150). 500 ft = 152 m, 200 ft = 61 m.' },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'query_building_attributes',
      description:
        'Filter campus buildings by a numeric or text attribute and map the matches. Use for building METRICS: RI (resilience index, 0-1.2), FCI (facility condition index), height (ft), year opened/completed, area, use type, ownership. Also use for historic resource questions: CHRS (Chicago Historic Resources Survey rating — actual values: orange, blue, yellow, green, red, purple; pass in lowercase, backend is case-insensitive) — use operator "=" or "contains" with the rating string. Example: buildings with RI above 0.52 → field "RI", operator ">", value 0.52. This is layer data — never answer these from planning documents. IMPORTANT: for ranking questions ("top 3 highest FCI", "tallest buildings", "oldest"), you MUST pass sortBy + sortOrder + topN — the map renders exactly the features this tool returns, so omitting them shows ALL matching buildings instead of the ranked subset.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: '"RI", "FCI", "height", "year", "area", "use", "ownership", "CHRS" (historic rating: orange/red/yellow/green), or an exact field name',
            },
            operator: { type: 'string', enum: ['>', '>=', '<', '<=', '=', 'contains'] },
            value: { description: 'Number for metric comparisons, string for contains/=' },
            maxResults: { type: 'number', default: 300 },
            sortBy: { type: 'string', description: 'Numeric field to sort by (e.g. "FCI", "height", "year", "RI"). Required for ranking questions.' },
            sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
            topN: { type: 'number', description: 'Return only the top N features after sorting. Use for "top 3 / highest / lowest / oldest / newest" questions.' },
          },
          required: ['field', 'operator', 'value'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_data_freshness',
      description:
        'Report when the campus data was last checked/updated: last nightly diff run, layers tracked, and the most recent detected changes. Use for "when was the data last updated" / data currency questions.',
      inputSchema: { json: { type: 'object', properties: {} } },
    },
  },
  {
    toolSpec: {
      name: 'query_campus_utilities',
      description:
        'PREFERRED tool for campus underground utility infrastructure: steam lines and vaults, chilled water, domestic water, sewers, stormwater detention, electrical lines/conduits/ComEd feeders, compressed air, walkable utility tunnels, valves. When the user names ANY campus building or place, ALWAYS pass it as nearLocation — results are then filtered and clipped to a rectangular area around it (any of the 308 campus building names resolve). Results render on the map. Attributes are CAD metadata only — no depth/diameter data yet.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            utilityType: {
              type: 'string',
              enum: ['steam', 'chilled_water', 'domestic_water', 'sewer', 'stormwater', 'electrical', 'compressed_air', 'tunnel', 'valves'],
              description: 'Utility system to query',
            },
            nearLocation: {
              type: 'string',
              description: 'Named campus location, e.g. "Regenstein Library" — omit to show the whole system',
            },
            radiusMeters: { type: 'number', default: 150 },
            maxResults: { type: 'number', default: 300 },
          },
          required: ['utilityType'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'find_buildings_by_year',
      description:
        'Find campus buildings filtered by construction year. Use for queries like "buildings before 1930", "buildings built after 2000", "oldest buildings on campus". Both before and after are exclusive bounds. Buildings with no year data are excluded and their count is reported separately.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            before: { type: 'integer', description: 'Return buildings completed before this year (exclusive), e.g. 1930' },
            after:  { type: 'integer', description: 'Return buildings completed after this year (exclusive), e.g. 2000' },
            maxResults: { type: 'integer', default: 60 },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_campus_events',
      description:
        'Fetch upcoming events from the University of Chicago official events calendar (events.uchicago.edu), sourced from the live iCal feed. ' +
        'Use for questions about lectures, performances, exhibitions, public talks, or anything happening on campus. Results are cached for 6 hours. ' +
        'Supports keyword filtering (e.g. "physics", "jazz", "public lecture"). ' +
        'Each event includes: id, title, date, startTime (HH:MM|null), endTime (HH:MM|null), location (building name|null), url, isOnline, isCanceled, summary (plain text), ' +
        'geo ({lat,lon}|null — coordinate of the event venue), categories (string[]), isAllDay (bool).',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            daysAhead: { type: 'integer', minimum: 1, maximum: 30, default: 7, description: 'Days ahead to search (default 7)' },
            limit: { type: 'integer', minimum: 1, maximum: 20, default: 10, description: 'Max events to return' },
            keyword: { type: 'string', description: 'Filter by keyword in title, summary, or location' },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_building_updates',
      description:
        'Report recent changes to campus building, tree, dining, or utility layer data — additions, removals, or modifications detected by the nightly data sync. Use for questions like "what changed recently on campus?", "were any new buildings added?", "has the tree inventory been updated?". Data comes from the automated daily diff pipeline.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            days: { type: 'integer', minimum: 1, maximum: 30, default: 7, description: 'How many days back to look (default 7)' },
            layer: {
              type: 'string',
              enum: ['buildings', 'trees', 'dining', 'utilities', 'all'],
              default: 'all',
              description: 'Which layer to filter changes for',
            },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'query_campus_layer',
      description:
        'Query campus point-of-interest and infrastructure layers from S3. Set nearLocation to filter by proximity. ' +
        'Layer catalog (key → key fields):\n' +
        '  Amenities: emergency_phone (OBJECTID,Number,Location) | trash_can (FID,Type) | benches (FID,Type,Donor,Text) | seating (FID,Area_AC) | public_arts (Title,Author,Date,Content)\n' +
        '  Sustainability: green_roof (FID,Type,Shape__Area)\n' +
        '  Accessibility: ada_route (Name,PopupInfo) | accessible_entrance (OBJECTID,AutomaticDoor,Orientation) | controlled_entrance (OBJECTID,Auto,Orientation) | accessibility_info (Building,Address,Elevator,Restroom,Notes) | inaccessible_entrance (OBJECTID,AutomaticDoor) | inaccessible_building (OBJECTID,Building,Alias)\n' +
        '  Fire & safety: hydrant (FID,TYPE,ASSET_ID) | fire_escape (FID) | sprinkler (FID) | standpipe (FID) | fire_lane (FID,Shape__Area) | post_indicator_valve (FID)\n' +
        '  Landmarks: landmark (LANDMARK_N,ID,ADDRESS,DATE_BUILT,ARCHITECT,HISTORY) | nrhp (Name,NRHP) | nhl (LANDMARK_N,ID,ADDRESS,DATE_BUILT,ARCHITECT,HISTORY)\n' +
        '  Parking & transit: surface_parking (FID,SFPARK_ID,Area_AC) | metra_station (NAME,LINES,ADA,FAREZONE,ADDRESS,STATUS)',
      inputSchema: {
        json: {
          type: 'object',
          required: ['layerName'],
          properties: {
            layerName: {
              type: 'string',
              enum: [
                'emergency_phone', 'trash_can', 'benches', 'seating', 'public_arts', 'green_roof',
                'ada_route', 'accessible_entrance', 'controlled_entrance',
                'accessibility_info', 'inaccessible_entrance', 'inaccessible_building',
                'hydrant', 'fire_escape', 'sprinkler', 'standpipe', 'fire_lane', 'post_indicator_valve',
                'landmark', 'nrhp', 'nhl',
                'surface_parking', 'metra_station',
              ],
              description: 'Which campus layer to query',
            },
            nearLocation: { type: 'string', description: 'Optional campus location name to filter by proximity' },
            radiusMeters: { type: 'number', minimum: 1, maximum: 2000, default: 400, description: 'Radius in meters when nearLocation is set' },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50, description: 'Max features to return' },
          },
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'search_planning_documents',
      description:
        'Semantic search over the PD 43 (Planned Development 43, the UChicago campus zoning district) document knowledge base: Chicago Zoning Ordinance chapters 17-8 and 17-17, PD 43 statements and amendments, City Council proceedings, Woodlawn Avenue plans, traffic management plan. Use for questions about zoning rules, FAR, height limits, permitted uses, setbacks, approvals, or planning history. The query must be an English keyword phrase — translate the user question if needed.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'English search phrase, e.g. "maximum floor area ratio subarea A"',
            },
            topK: { type: 'number', description: 'Number of passages to retrieve (1-10)', default: 5 },
          },
          required: ['query'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_academic_calendar',
      description:
        'Return University of Chicago academic calendar dates: quarter start/end, instruction begins/ends, exam weeks, holiday breaks (Thanksgiving, winter, spring), registration and add/drop deadlines, Convocation. ' +
        'Use for ANY question about academic dates or schedules. This tool has no map output — it answers in text only. ' +
        'Data is fetched from the official college catalog and cached for 7 days.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            quarter: {
              type: 'string',
              enum: ['autumn', 'winter', 'spring', 'summer'],
              description: 'Which quarter to filter by. Omit to return all quarters.',
            },
            academicYear: {
              type: 'string',
              description: 'Academic year, e.g. "2026-27". Omit for current academic year.',
            },
            kind: {
              type: 'string',
              enum: ['all', 'instruction', 'exams', 'breaks', 'deadlines'],
              description: 'Filter by event type. Omit or "all" for everything.',
            },
          },
        },
      },
    },
  },
]

function buildSessionContext(turns: SessionTurn[]): string {
  if (!turns.length) return ''
  const lines = turns
    .map(
      (t, i) =>
        `  [${i + 1}] User: "${t.query}" → ${t.featureCount} features. Summary: ${t.summary}`
    )
    .join('\n')
  return `\nSession history (${turns.length} prior ${turns.length === 1 ? 'query' : 'queries'} — use for follow-up context, e.g. filter/refine previous results):\n${lines}\n`
}

function buildSystemPrompt(sessionHistory: SessionTurn[] = []): string {
  const currentYear = new Date().getFullYear()
  const sessionContext = buildSessionContext(sessionHistory)
  return `You are CampusGeo, an AI geospatial assistant for the University of Chicago. You have access to real-time campus data through tools.

Current year: ${currentYear}. Use this to resolve relative time references in queries (e.g. "at least 20 years old" means Year_Completed <= ${currentYear - 20}, "built in the last decade" means Year_Completed >= ${currentYear - 10}).${sessionContext}
Guidelines:
- Be direct and specific. Give exact locations, distances, and counts.
- Use tools to look up live data before answering spatial questions.
- When referencing a campus location, always mention the building name and what it's used for.
- For shuttle/bike queries, always call the relevant tool even if you think you know the answer.
- Format responses concisely — this is a map app, not a chat.
- If a layer query returns geometry, the frontend will automatically display it on the map.
- For zoning, planning, FAR, height-limit, land-use, or approval questions, search the PD 43 document knowledge base first (search_planning_documents). Cite every regulatory claim with document name and page, e.g. (Chicago Zoning Ordinance 17-8, p.12). If the retrieved passages do not answer the question, say so plainly — never invent regulatory content.
- Building METRICS (RI, FCI, height, year, area) are LAYER DATA: use query_building_attributes, never the document search. Data-currency questions: use get_data_freshness.
- Historic resource questions (CHRS rating, preservation status, demolition review, landmark eligibility): use query_building_attributes with field="CHRS", operator="=" or "contains", value=<rating>. CHRS is a categorical string — do NOT use numeric operators. Actual values in the data (pass in lowercase; the backend normalizes): "orange" (potentially significant, 81 buildings), "blue" (49 buildings), "yellow" (good integrity, 13), "green" (5), "red" (Chicago Landmark, 1), "purple" (1); blank/space/null = not rated (158 buildings). Do NOT fall back to the citywide landmark (ICL) layer for campus historic questions — that layer covers all of Chicago and will return hundreds of off-campus features.
- Citywide layers (landmarks, ICL, NHL, census, zoning) are full-city datasets. Never return more than ~50 features for a campus-scoped question. If a citywide query would return more, tell the user to narrow the scope.
- Architect/designer queries: use query_building_attributes with field="architect", operator="contains", value=<partial firm name>. For multiple architects, call the tool once per architect then merge the feature lists before returning. Use partial names to handle spelling variants (e.g. "Coolidge" matches "Coolidge & Hodgdon" and "Shepley, Rutan, and Coolidge").
- To show ALL buildings (e.g. "map all buildings", "gradient by age", "color by year"), call query_building_attributes with field="year", operator=">=", value=1800 — this returns all buildings that have a year recorded. Never answer building visualization requests from memory.
- Tone: intelligent, direct, evidence-based. No filler phrases. No emoji, no exclamation marks.`
}

type SSECallback = (event: { type: string; [key: string]: unknown }) => void

// The system prompt only *asks* the model to cite retrieved passages; nothing
// enforces it. Compare every "(document, p.N)"-style citation in the final
// answer against the passages actually returned by search_planning_documents
// and flag the ones that don't correspond — streamed text can't be retracted,
// so an explicit warning event is the enforceable floor.
interface RetrievedCitation {
  document: string
  page: number
}

export function findUnverifiedCitations(text: string, retrieved: RetrievedCitation[]): string[] {
  const unverified: string[] = []
  // Covers (Doc, p.12), (Doc, page 12), (Doc, pp. 12-14) and the [Doc, p.12]
  // bracket variant; ranges are verified against their first page.
  const citationPattern = /[([]([^()[\]]{3,120}?),\s*p(?:age|p)?\.?\s*(\d{1,4})(?:\s*[-–—]\s*\d{1,4})?[)\]]/gi
  for (const match of text.matchAll(citationPattern)) {
    const citedDoc = match[1].trim().toLowerCase()
    const citedPage = Number(match[2])
    const ok = retrieved.some((r) => {
      const doc = r.document.toLowerCase()
      return r.page === citedPage && (doc.includes(citedDoc) || citedDoc.includes(doc))
    })
    if (!ok) unverified.push(match[0])
  }
  return unverified
}

export async function runCampusGeoAgent(
  userQuery: string,
  sessionId: string,
  onEvent: SSECallback,
  sessionHistory: SessionTurn[] = []
): Promise<void> {
  const messages: Message[] = [{ role: 'user', content: [{ text: userQuery }] }]
  const retrievedCitations: RetrievedCitation[] = []
  let answerText = ''

  for (let turn = 0; turn < 6; turn++) {
    const command = new ConverseStreamCommand({
      modelId: BEDROCK_MODEL,
      system: [{ text: buildSystemPrompt(sessionHistory) }],
      messages,
      toolConfig: { tools: CAMPUS_TOOLS },
      inferenceConfig: {
        maxTokens: 1024,
        temperature: 0.2,
      },
    })

    const response = await client.send(command)
    if (!response.stream) break

    let stopReason: string | undefined
    const assistantContent: ContentBlock[] = []
    let currentToolUse: { toolUseId: string; name: string; inputJson: string } | null = null
    let currentTextBlock = ''

    for await (const streamEvent of response.stream) {
      if (streamEvent.contentBlockStart?.start?.toolUse) {
        const tu = streamEvent.contentBlockStart.start.toolUse
        currentToolUse = { toolUseId: tu.toolUseId!, name: tu.name!, inputJson: '' }
        onEvent({ type: 'tool_call', toolName: tu.name! })
      }

      if (streamEvent.contentBlockDelta?.delta?.text) {
        const text = streamEvent.contentBlockDelta.delta.text
        currentTextBlock += text
        answerText += text
        onEvent({ type: 'text', content: text })
      }

      if (streamEvent.contentBlockDelta?.delta?.toolUse?.input) {
        if (currentToolUse) {
          currentToolUse.inputJson += streamEvent.contentBlockDelta.delta.toolUse.input
        }
      }

      if (streamEvent.contentBlockStop !== undefined) {
        if (currentTextBlock) {
          assistantContent.push({ text: currentTextBlock })
          currentTextBlock = ''
        }
        if (currentToolUse) {
          let parsedInput: unknown = {}
          try { parsedInput = JSON.parse(currentToolUse.inputJson || '{}') } catch { /* ignore */ }
          assistantContent.push({
            toolUse: {
              toolUseId: currentToolUse.toolUseId,
              name: currentToolUse.name,
              input: parsedInput as DocumentType,
            },
          })
          currentToolUse = null
        }
      }

      if (streamEvent.messageStop) {
        stopReason = streamEvent.messageStop.stopReason
      }
    }

    messages.push({ role: 'assistant', content: assistantContent })

    if (stopReason === 'end_turn' || stopReason === 'stop_sequence') break

    if (stopReason === 'tool_use') {
      const toolResults: ContentBlock[] = []

      for (const block of assistantContent) {
        if (!block.toolUse) continue

        const { toolUseId, name, input } = block.toolUse
        let result: unknown

        try {
          result = await executeTool(name!, input as Record<string, unknown>)
        } catch (err) {
          // Full detail (zod field paths, expected/received) stays server-side;
          // the tool_result event reaches the client, so it gets generic text.
          console.error(`tool ${name} error:`, err)
          result =
            err instanceof Error && err.name === 'ZodError'
              ? { error: `Invalid input for ${name}` }
              : { error: `Tool ${name} failed` }
        }

        if (name === 'search_planning_documents') {
          const passages = (result as { passages?: Array<{ document?: string; page?: number }> })?.passages
          for (const p of passages ?? []) {
            if (typeof p.document === 'string' && typeof p.page === 'number') {
              retrievedCitations.push({ document: p.document, page: p.page })
            }
          }
        }

        // Extract GeoJSON for map update if tool returned features
        const resultObj = result as Record<string, unknown>
        if (resultObj?.features && typeof resultObj.features === 'object') {
          onEvent({
            type: 'tool_result',
            toolName: name!,
            mapUpdate: {
              features: resultObj.features,
              center: resultObj.center,
            },
          })
        } else {
          onEvent({ type: 'tool_result', toolName: name!, data: result })
        }

        // Tools may provide a compact _modelSummary: the full geometry payload
        // reaches the map via the mapUpdate event above, while the model only
        // reasons over the summary — keeps token usage flat for dense layers.
        // Bedrock requires { json: <object> } — never a primitive. Wrap strings/arrays defensively.
        const rawSummary = (resultObj?._modelSummary as DocumentType | undefined) ?? (result as DocumentType)
        const modelResult: DocumentType = (rawSummary !== null && typeof rawSummary === 'object' && !Array.isArray(rawSummary))
          ? rawSummary
          : { value: rawSummary }

        toolResults.push({
          toolResult: {
            toolUseId: toolUseId!,
            content: [{ json: modelResult }],
          },
        })
      }

      messages.push({ role: 'user', content: toolResults })
    }
  }

  // Validate whenever the answer CONTAINS citations — not only when retrieval
  // ran. If the model cited documents without ever calling
  // search_planning_documents, every citation is unverified: that pure
  // fabrication is exactly the case this control exists for.
  const unverified = findUnverifiedCitations(answerText, retrievedCitations)
  if (unverified.length) {
    onEvent({
      type: 'citation_warning',
      message: 'Some citations could not be matched to retrieved passages and may be unreliable.',
      unverified,
    })
  }

  onEvent({ type: 'done' })
}

async function executeTool(name: string, rawInput: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_shuttle_arrivals': {
      const input = GetShuttleArrivalsInputSchema.parse(rawInput)
      return getShuttleArrivals(input)
    }
    case 'get_bike_stations': {
      const input = GetBikeStationsInputSchema.parse(rawInput)
      return getBikeStations(input)
    }
    case 'find_campus_nearby': {
      const input = FindCampusNearbyInputSchema.parse(rawInput)
      return findCampusNearby(input)
    }
    case 'get_building_info': {
      const input = GetBuildingInfoInputSchema.parse(rawInput)
      return getBuildingInfo(input)
    }
    case 'check_hours': {
      const input = CheckHoursInputSchema.parse(rawInput)
      return checkHours(input)
    }
    case 'query_trees': {
      const input = QueryTreesInputSchema.parse(rawInput)
      return queryTrees(input)
    }
    case 'search_planning_documents': {
      const input = SearchDocumentsInputSchema.parse(rawInput)
      return searchDocuments(input)
    }
    case 'query_campus_utilities': {
      const input = QueryUtilitiesInputSchema.parse(rawInput)
      return queryUtilities(input)
    }
    case 'query_building_attributes': {
      const input = QueryBuildingAttributesInputSchema.parse(rawInput)
      return queryBuildingAttributes(input)
    }
    case 'find_buildings_by_year': {
      const input = FindBuildingsByYearInputSchema.parse(rawInput)
      return findBuildingsByYear(input)
    }
    case 'get_data_freshness': {
      const input = GetDataFreshnessInputSchema.parse(rawInput)
      return getDataFreshness(input)
    }
    case 'get_campus_events': {
      const input = GetCampusEventsInputSchema.parse(rawInput)
      return getCampusEvents(input)
    }
    case 'get_building_updates': {
      const input = GetBuildingUpdatesInputSchema.parse(rawInput)
      return getBuildingUpdates(input)
    }
    case 'query_campus_layer': {
      const input = QueryCampusLayerInputSchema.parse(rawInput)
      return queryCampusLayer(input)
    }
    case 'get_academic_calendar': {
      const input = GetAcademicCalendarInputSchema.parse(rawInput)
      return getAcademicCalendar(input)
    }
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
