import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
  type Tool,
  type ContentBlock,
} from '@aws-sdk/client-bedrock-runtime'
import type { DocumentType } from '@smithy/types'
import { queryArcGIS, QueryArcGISInputSchema } from './tools/campus/queryArcGIS'
import { getShuttleArrivals, GetShuttleArrivalsInputSchema } from './tools/campus/getShuttleArrivals'
import { getBikeStations, GetBikeStationsInputSchema } from './tools/campus/getBikeStations'
import { findCampusNearby, FindCampusNearbyInputSchema } from './tools/campus/findCampusNearby'
import { getBuildingInfo, GetBuildingInfoInputSchema } from './tools/campus/getBuildingInfo'
import { checkHours, CheckHoursInputSchema } from './tools/campus/checkHours'
import { queryTrees, QueryTreesInputSchema } from './tools/campus/queryTrees'
import { searchDocuments, SearchDocumentsInputSchema } from './tools/campus/searchDocuments'
import { queryUtilities, QueryUtilitiesInputSchema } from './tools/campus/queryUtilities'

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
// BEDROCK_REGION may differ from the Lambda's own region when the model is an
// application inference profile pinned to another region (prod uses us-east-2).
const AWS_REGION = process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1'

const client = new BedrockRuntimeClient({ region: AWS_REGION })

// Tool definitions for Bedrock
const CAMPUS_TOOLS: Tool[] = [
  {
    toolSpec: {
      name: 'query_arcgis_layer',
      description:
        'Query UChicago ArcGIS feature layers by attribute or spatial filter. Returns GeoJSON features for campus buildings, bike racks, electrical lines, parking, accessible paths, and dining. Use this to answer questions about campus facilities.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            layerName: {
              type: 'string',
              enum: ['bike_racks', 'buildings', 'electrical', 'parking', 'accessible', 'dining'],
              description: 'Campus data layer to query',
            },
            whereClause: {
              type: 'string',
              description: "SQL WHERE clause for filtering, e.g. BLDG_NAME='Regenstein Library'",
            },
            maxResults: { type: 'number', description: 'Max features to return (1-100)', default: 20 },
            returnGeometry: { type: 'boolean', default: true },
          },
          required: ['layerName'],
        },
      },
    },
  },
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
        'Find campus features (buildings, dining, accessible paths) within a radius of a named location. Returns sorted by distance. NOTE: bike racks and parking are not yet available in S3.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            referenceLocation: { type: 'string', description: 'Named campus location, e.g. "Regenstein Library"' },
            featureType: {
              type: 'string',
              enum: ['building', 'dining', 'accessible'],
              description: 'Type of feature to find nearby (bike_rack and parking temporarily unavailable)',
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
        'Get detailed info about a specific UChicago building: use type, address, accessibility, floor count, year built. Use when user asks about a specific building.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            buildingIdentifier: { type: 'string', description: 'Building name or number, e.g. "Regenstein Library" or "302"' },
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
        'Check if a campus location (library, dining hall, athletics center) is currently open, and when it opens/closes.',
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
        'Query Main Quad tree inventory data. Filter by species (common name like "Maple", "Ash", "Oak"), age class ("Young", "Semi-mature", "Mature"), condition ("Good", "Fair", "Poor"), or minimum diameter. Returns tree locations and statistics. Total inventory: 539 trees.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            species: { type: 'string', description: 'Tree species common name (e.g., "Maple", "Ash")' },
            ageClass: { type: 'string', description: 'Age class: "Young", "Semi-mature", or "Mature"' },
            condition: { type: 'string', description: 'Tree condition: "Good", "Fair", or "Poor"' },
            minDiameter: { type: 'number', description: 'Minimum trunk diameter in cm' },
            location: { type: 'string', description: 'Location description' },
          },
        },
      },
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
]

const SYSTEM_PROMPT = `You are CampusGeo, an AI geospatial assistant for the University of Chicago. You have access to real-time campus data through tools.

Guidelines:
- Be direct and specific. Give exact locations, distances, and counts.
- Use tools to look up live data before answering spatial questions.
- When referencing a campus location, always mention the building name and what it's used for.
- For shuttle/bike queries, always call the relevant tool even if you think you know the answer.
- Format responses concisely — this is a map app, not a chat.
- If a layer query returns geometry, the frontend will automatically display it on the map.
- For zoning, planning, FAR, height-limit, land-use, or approval questions, search the PD 43 document knowledge base first (search_planning_documents). Cite every regulatory claim with document name and page, e.g. (Chicago Zoning Ordinance 17-8, p.12). If the retrieved passages do not answer the question, say so plainly — never invent regulatory content.
- Tone: intelligent, direct, evidence-based. No filler phrases. No emoji, no exclamation marks.`

type SSECallback = (event: { type: string; [key: string]: unknown }) => void

export async function runCampusGeoAgent(
  userQuery: string,
  sessionId: string,
  onEvent: SSECallback
): Promise<void> {
  const messages: Message[] = [{ role: 'user', content: [{ text: userQuery }] }]

  for (let turn = 0; turn < 6; turn++) {
    const command = new ConverseStreamCommand({
      modelId: BEDROCK_MODEL,
      system: [{ text: SYSTEM_PROMPT }],
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
          result = { error: err instanceof Error ? err.message : String(err) }
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
        const modelResult = (resultObj?._modelSummary as DocumentType | undefined) ?? (result as DocumentType)

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

  onEvent({ type: 'done' })
}

async function executeTool(name: string, rawInput: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'query_arcgis_layer': {
      const input = QueryArcGISInputSchema.parse(rawInput)
      return queryArcGIS(input)
    }
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
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
