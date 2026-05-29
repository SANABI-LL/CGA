import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
  type Tool,
  type ContentBlock,
} from '@aws-sdk/client-bedrock-runtime'
import { queryArcGIS, QueryArcGISInputSchema } from './tools/campus/queryArcGIS'
import { getShuttleArrivals, GetShuttleArrivalsInputSchema } from './tools/campus/getShuttleArrivals'
import { getBikeStations, GetBikeStationsInputSchema } from './tools/campus/getBikeStations'
import { findCampusNearby, FindCampusNearbyInputSchema } from './tools/campus/findCampusNearby'
import { getBuildingInfo, GetBuildingInfoInputSchema } from './tools/campus/getBuildingInfo'
import { checkHours, CheckHoursInputSchema } from './tools/campus/checkHours'

const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-3-5-sonnet-20241022-v2:0'
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'

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
        'Find campus features (buildings, bike racks, parking, dining, accessible paths) within a radius of a named location. Returns sorted by distance.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            referenceLocation: { type: 'string', description: 'Named campus location, e.g. "Regenstein Library"' },
            featureType: {
              type: 'string',
              enum: ['bike_rack', 'building', 'dining', 'parking', 'accessible'],
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
]

const SYSTEM_PROMPT = `You are CampusGeo, an AI geospatial assistant for the University of Chicago. You have access to real-time campus data through tools.

Guidelines:
- Be direct and specific. Give exact locations, distances, and counts.
- Use tools to look up live data before answering spatial questions.
- When referencing a campus location, always mention the building name and what it's used for.
- For shuttle/bike queries, always call the relevant tool even if you think you know the answer.
- Format responses concisely — this is a map app, not a chat.
- If a layer query returns geometry, the frontend will automatically display it on the map.
- Tone: intelligent, direct, evidence-based. No filler phrases.`

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
              input: parsedInput,
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

        toolResults.push({
          toolResult: {
            toolUseId: toolUseId!,
            content: [{ json: result as Record<string, unknown> }],
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
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
