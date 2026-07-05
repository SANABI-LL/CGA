// CampusGeo — Lambda Query Handler
// Runtime: Node.js 20.x (CommonJS)
// Dependencies: @aws-sdk/client-bedrock-runtime, @aws-sdk/client-s3,
//   @turf/centroid, @turf/buffer, @turf/boolean-point-in-polygon
//   (NOT the full @turf/turf bundle — it pulls in concaveman, an ESM module
//    that breaks Lambda's CommonJS require)

const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
// .default for ESM-interop builds, fall back to the module itself for plain CJS
const _centroid = require('@turf/centroid');
const _buffer = require('@turf/buffer');
const _bpip = require('@turf/boolean-point-in-polygon');
const centroid = _centroid.default || _centroid.centroid || _centroid;
const buffer = _buffer.default || _buffer.buffer || _buffer;
const booleanPointInPolygon = _bpip.default || _bpip.booleanPointInPolygon || _bpip;
const fs = require('fs');
const path = require('path');

// Bedrock must be us-east-2 to match the application-inference-profile ARN region.
// S3 stays us-east-1 (that is where the geodata bucket lives) — cross-region is fine.
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || 'us-east-2' });
const s3     = new S3Client({ region: 'us-east-1' });
const BUCKET = process.env.GEODATA_BUCKET || 'campusgeo-geodata-491117467175';
// Model ID is read from env var BEDROCK_MODEL_ID so it can be swapped without
// repackaging code. Default = the UChicago application-inference-profile ARN (us-east-2).
// The ARN region MUST match the Bedrock client region above.
const MODEL  = process.env.BEDROCK_MODEL_ID || 'arn:aws:bedrock:us-east-2:491117467175:application-inference-profile/3tn0yx57dsmx';

// Single source of truth for the default buffer radius — interpolated into the
// tool schema and the system prompt so the three copies can never drift.
const DEFAULT_RADIUS_M = 150;

// ── GeoJSON cache — warm Lambda reuses /tmp ──────────────────────────────
const memCache = {};
async function loadLayer(key) {
  if (memCache[key]) return memCache[key];
  const tmp = path.join('/tmp', key.replace(/\//g, '_'));
  if (fs.existsSync(tmp)) {
    memCache[key] = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    return memCache[key];
  }
  const res  = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = await res.Body.transformToString();
  fs.writeFileSync(tmp, body);
  memCache[key] = JSON.parse(body);
  return memCache[key];
}

// ── Tool definitions (from Intent Taxonomy) ──────────────────────────────
const TOOLS = [
  {
    toolSpec: {
      name: 'locate_feature',
      description: 'Find one named building or campus place and center the map on it.',
      inputSchema: {
        json: {
          type: 'object',
          required: ['name'],
          properties: {
            name:  { type: 'string', description: 'Building name or known alias' },
            layer: { type: 'string', enum: ['buildings', 'trees'] }
          }
        }
      }
    }
  },
  {
    toolSpec: {
      name: 'filter_features',
      description: 'Return features matching attribute predicates. Use for species (CommonName), year, ownership, condition.',
      inputSchema: {
        json: {
          type: 'object',
          required: ['layer', 'filters'],
          properties: {
            layer: { type: 'string', enum: ['buildings', 'trees'] },
            filters: {
              type: 'array',
              items: {
                type: 'object',
                required: ['field', 'op', 'value'],
                properties: {
                  field: { type: 'string' },
                  op:    { type: 'string', enum: ['eq', 'neq', 'gt', 'lt', 'between', 'contains'] },
                  value: {}
                }
              }
            },
            match: { type: 'string', enum: ['all', 'any'] }
          }
        }
      }
    }
  },
  {
    toolSpec: {
      name: 'features_within',
      description: 'Find features within a distance of an anchor location. Optionally filter the results by attributes (species, condition, year, ownership) at the same time. Use this for ANY query that combines a place ("near X", "within Nm of X") with a feature description ("green ash trees", "owned buildings").',
      inputSchema: {
        json: {
          type: 'object',
          required: ['anchor_name'],
          properties: {
            anchor_name:  { type: 'string' },
            distance_m:   { type: 'number', description: `Buffer radius in metres. Default ${DEFAULT_RADIUS_M} if unspecified.` },
            target_layer: { type: 'string', enum: ['buildings', 'trees'], description: 'Layer to search. Always set this; use "trees" for tree/species queries.' },
            filters: {
              type: 'array',
              description: 'Optional attribute filters applied to results',
              items: {
                type: 'object',
                required: ['field', 'op', 'value'],
                properties: {
                  field: { type: 'string' },
                  op:    { type: 'string', enum: ['eq', 'neq', 'gt', 'lt', 'between', 'contains'] },
                  value: {}
                }
              }
            },
            match: { type: 'string', enum: ['all', 'any'], description: 'How to combine filters. Default all.' },
            mode:         { type: 'string', enum: ['within', 'nearest_k'], description: 'within (default): everything inside distance_m. nearest_k: the k nearest features, ignoring distance_m.' },
            k:            { type: 'number', description: 'Number of features to return when mode is nearest_k. Default 5.' }
          }
        }
      }
    }
  },
  {
    toolSpec: {
      name: 'aggregate_features',
      description: 'Count, sum, or average a numeric field. Optionally group by a dimension.',
      inputSchema: {
        json: {
          type: 'object',
          required: ['metric', 'layer'],
          properties: {
            metric:   { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] },
            field:    { type: 'string' },
            group_by: { type: 'string' },
            layer:    { type: 'string', enum: ['buildings', 'trees'] }
          }
        }
      }
    }
  },
  {
    toolSpec: {
      name: 'rank_features',
      description: 'Return top-N features sorted by a field (tallest, oldest, largest, highest FCI).',
      inputSchema: {
        json: {
          type: 'object',
          required: ['sort_field', 'layer'],
          properties: {
            sort_field: { type: 'string' },
            direction:  { type: 'string', enum: ['desc', 'asc'] },
            limit:      { type: 'number' },
            layer:      { type: 'string', enum: ['buildings', 'trees'] }
          }
        }
      }
    }
  }
];

// ── System prompt ────────────────────────────────────────────────────────
const SYSTEM = `You are CampusGeo, a spatial intelligence assistant for the University of Chicago campus.
You have access to two data layers:

buildings: 308 campus building footprints.
  Key fields: DISCRIPT1 (building name), BD_ID, Year_Completed, BLDG_HGT (height in ft),
  Gross_Area__s_f__ (gross area sq ft), PROPERTY_S (Owned or Leased),
  FCI__ (Facility Condition Index: 0=good, >0.30=poor), Elevator (ADA proxy),
  Architects, ADDRESS, Lat, Lon.

trees: Campus tree inventory.
  Key fields: TreeID, CommonName (format "Type-Variety", e.g. "Linden-Littleleaf", "Maple-Norway"),
  Condition. NOTE: year_planted is not yet populated — do not filter by it.

Rules:
- Always call exactly one tool. Never respond without using a tool.
- Respond in the same language as the user (English or Chinese).
- Never invent data not in the layers.
- For queries outside scope, use filter_features with an empty filters array — the
  system will respond that the query is outside the campus data layers.
- For species queries WITHOUT a location, use filter_features with op:"contains" on field "CommonName".

When a query combines a LOCATION ("near X", "within N metres of X", "around X")
with a feature description ("green ash trees", "owned buildings", "trees in poor
condition"), you MUST call features_within with the filters array, and always set
target_layer. Do not call filter_features for these — it ignores location and
returns the whole campus.
For "the N nearest/closest ..." queries, call features_within with mode:"nearest_k" and k:N.
Species live in CommonName as "Type-Variety" (e.g. green ash = "Ash-Green",
use op "contains" with value "Ash-Green"). Omit distance_m if the user gave no
distance (it defaults to ${DEFAULT_RADIUS_M}m).`;

// ── Shared filter predicate (hoist to module scope; used by both tools) ──
function matchesFilters(props, filters, match) {
  if (!filters || !filters.length) return true;
  // ?? (not ||): 0 is a legitimate value for fields like Elevator and FCI__
  const pred = (flt) => {
    const v = props[flt.field];
    switch (flt.op) {
      case 'eq':      return String(v ?? '').toLowerCase() === String(flt.value).toLowerCase();
      case 'neq':     return String(v ?? '').toLowerCase() !== String(flt.value).toLowerCase();
      case 'gt':      return Number(v) > Number(flt.value);
      case 'lt':      return Number(v) < Number(flt.value);
      case 'contains':return String(v ?? '').toLowerCase().includes(String(flt.value).toLowerCase());
      case 'between': return Array.isArray(flt.value) && flt.value.length === 2 &&
                             Number(v) >= Number(flt.value[0]) && Number(v) <= Number(flt.value[1]);
      default:        return true;
    }
  };
  return match === 'any' ? filters.some(pred) : filters.every(pred);
}

// ── Great-circle distance in metres (nearest_k ranking) ─────────────────
function haversineM([lon1, lat1], [lon2, lat2]) {
  const R = 6371000, d = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * d / 2) ** 2 +
            Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin((lon2 - lon1) * d / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Main handler ─────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.requestContext && event.requestContext.http && event.requestContext.http.method === 'OPTIONS') {
    return respond(200, {});
  }

  let q = '';
  try {
    const body = JSON.parse(event.body || '{}');
    q = (body.q || '').trim();
  } catch (e) {
    return respond(400, { error: 'Invalid JSON body' });
  }

  if (!q) return respond(400, { error: 'q is required' });

  try {
    // Load layers in parallel (cached in /tmp on warm invocations)
    const [buildings, trees] = await Promise.all([
      loadLayer('layers/buildings.geojson'),
      loadLayer('layers/trees.geojson'),
    ]);

    // Ask Bedrock to classify intent and extract parameters
    const converse = await bedrock.send(new ConverseCommand({
      modelId: MODEL,
      system: [{ text: SYSTEM }],
      messages: [{ role: 'user', content: [{ text: q }] }],
      toolConfig: { tools: TOOLS, toolChoice: { auto: {} } },
    }));

    const toolUse = (converse.output?.message?.content || [])
      .find(c => c.toolUse)?.toolUse;

    if (!toolUse) {
      return respond(200, {
        answer: 'I could not understand that query. Try asking about a building, tree species, or campus location.',
        features: null,
        mapAction: null,
        intent: 'unrecognized'
      });
    }

    const result = await executeIntent(toolUse.name, toolUse.input, buildings, trees);
    return respond(200, { ...result, intent: toolUse.name });

  } catch (err) {
    console.error('Handler error:', err);
    return respond(500, { error: 'Internal error', message: err.message });
  }
};

// ── Intent executors ─────────────────────────────────────────────────────
async function executeIntent(tool, input, buildings, trees) {
  const getLayer = () => input.layer === 'trees' ? trees : buildings;
  const nameOf   = (f) => (f.properties.DISCRIPT1 || f.properties.CommonName || '').trim();
  const findByName = (feats, q) => feats.find(f =>
    [f.properties.DISCRIPT1, f.properties.CommonName, f.properties.OtherNames, f.properties.ADDRESS]
      .some(v => v && v.toLowerCase().includes(q.toLowerCase()))
  );

  switch (tool) {

    case 'locate_feature': {
      const hit = findByName(getLayer().features, input.name);
      if (!hit) return {
        answer: `No feature named "${input.name}" found on campus.`,
        features: null, mapAction: null, layer: input.layer || 'buildings'
      };
      return {
        answer: `${nameOf(hit)} is located at ${hit.properties.ADDRESS || 'campus'}.`,
        features: { type: 'FeatureCollection', features: [hit] },
        mapAction: {
          type: 'locate',
          center: [parseFloat(hit.properties.Lon), parseFloat(hit.properties.Lat)],
          zoom: 17
        },
        layer: input.layer || 'buildings'
      };
    }

    case 'filter_features': {
      // Empty filters is the SYSTEM-prompt signal for an out-of-scope query —
      // answer with the limitation instead of dumping the entire layer.
      if (!input.filters || !input.filters.length) {
        return {
          answer: 'This query is outside the campus data layers (buildings and trees).',
          features: { type: 'FeatureCollection', features: [] },
          mapAction: null,
          layer: input.layer || 'buildings'
        };
      }
      const feats = getLayer().features;
      const hits = feats.filter(f => matchesFilters(f.properties, input.filters, input.match));
      return {
        answer: `Found ${hits.length} ${input.layer} matching your criteria.`,
        features: { type: 'FeatureCollection', features: hits },
        mapAction: { type: 'highlight' },
        layer: input.layer || 'buildings'
      };
    }

    case 'features_within': {
      const anchor = findByName(buildings.features, input.anchor_name);
      if (!anchor) return {
        answer: `Could not find "${input.anchor_name}" as an anchor location.`,
        features: null, mapAction: null
      };
      const pt  = centroid(anchor);
      const radius = input.distance_m ?? DEFAULT_RADIUS_M;  // ?? — an explicit 0 must stay 0

      // If target_layer is missing, infer it from the filter fields instead of
      // silently defaulting to buildings (a CommonName filter on buildings
      // matches nothing and would return a confident empty result).
      let tgt;
      if (input.target_layer) {
        tgt = input.target_layer === 'trees' ? trees : buildings;
      } else {
        const hasField = (layer, fld) =>
          layer.features[0] && fld in layer.features[0].properties;
        const flds = (input.filters || []).map(fl => fl.field);
        const treeScore = flds.filter(fld => hasField(trees, fld)).length;
        const bldgScore = flds.filter(fld => hasField(buildings, fld)).length;
        tgt = treeScore > bldgScore ? trees : buildings;
      }
      const layerName = tgt === trees ? 'trees' : 'buildings';

      // Attribute filter first — it is far cheaper than per-feature geometry.
      const candidates = tgt.features
        .filter(f => matchesFilters(f.properties, input.filters, input.match));

      let hits, radiusM = radius;
      if (input.mode === 'nearest_k') {
        const k = input.k || 5;
        hits = candidates
          .map(f => {
            try { return { f, d: haversineM(pt.geometry.coordinates, centroid(f).geometry.coordinates) }; }
            catch { return null; }
          })
          .filter(Boolean)
          .sort((a, b) => a.d - b.d)
          .slice(0, k);
        // ring radius = distance to the farthest of the k hits, so the map shows them all
        radiusM = hits.length ? Math.ceil(hits[hits.length - 1].d) : radius;
        hits = hits.map(h => h.f);
      } else {
        const buf = buffer(pt, radius / 1000, { units: 'kilometers' });
        hits = candidates.filter(f => {
          try { return booleanPointInPolygon(centroid(f), buf); }
          catch { return false; }
        });
      }

      const hasFilters = !!(input.filters && input.filters.length);
      const filterSuffix = hasFilters
        ? ` matching ${input.filters.map(fl => `${fl.field} ${fl.op} ${fl.value}`).join(', ')}`
        : '';
      const answer = input.mode === 'nearest_k'
        ? `The ${hits.length} nearest ${layerName} to ${nameOf(anchor)}${filterSuffix} (all within ${radiusM}m).`
        : `${hits.length} ${layerName} within ${radius}m of ${nameOf(anchor)}${filterSuffix}.`;

      return {
        answer,
        features: { type: 'FeatureCollection', features: hits },
        mapAction: {
          type: 'buffer',
          center: pt.geometry.coordinates,
          radiusM
        },
        layer: layerName
      };
    }

    case 'aggregate_features': {
      const feats = getLayer().features;
      let answer = '';
      if (input.metric === 'count' && !input.field) {
        if (input.group_by) {
          const g = {};
          feats.forEach(f => {
            const k = String(f.properties[input.group_by] || 'Unknown').trim();
            g[k] = (g[k] || 0) + 1;
          });
          const entries = Object.entries(g).sort((a, b) => b[1] - a[1]);
          answer = entries.slice(0, 10).map(([k, v]) => `${k}: ${v}`).join(', ');
        } else {
          answer = `There are ${feats.length} ${input.layer} on the campus.`;
        }
      } else if (input.field) {
        const vals = feats.map(f => Number(f.properties[input.field])).filter(n => !isNaN(n));
        let r;
        switch (input.metric) {
          case 'sum': r = vals.reduce((a, b) => a + b, 0); break;
          case 'avg': r = vals.reduce((a, b) => a + b, 0) / vals.length; break;
          case 'min': r = Math.min(...vals); break;
          case 'max': r = Math.max(...vals); break;
          default:    r = vals.length;
        }
        answer = `The ${input.metric} of ${input.field} across ${vals.length} ${input.layer} is ${Number(r).toFixed(2)}.`;
      }
      return { answer, features: null, mapAction: null, meta: { metric: input.metric }, layer: input.layer || 'buildings' };
    }

    case 'rank_features': {
      const feats = getLayer().features
        .filter(f => f.properties[input.sort_field] != null)
        .sort((a, b) => {
          const av = Number(a.properties[input.sort_field]);
          const bv = Number(b.properties[input.sort_field]);
          return input.direction === 'asc' ? av - bv : bv - av;
        });
      const hits = feats.slice(0, input.limit || 5);
      const top  = hits[0] ? nameOf(hits[0]) : '—';
      return {
        answer: `Top ${hits.length} ${input.layer} by ${input.sort_field}: ${top} is #1.`,
        features: { type: 'FeatureCollection', features: hits },
        mapAction: { type: 'highlight' },
        layer: input.layer || 'buildings'
      };
    }

    default:
      return { answer: 'Intent not yet implemented.', features: null, mapAction: null };
  }
}

// Exposed for local tests only — not part of the Lambda contract.
exports._internal = { executeIntent, matchesFilters };

// ── Response helper ──────────────────────────────────────────────────────
function respond(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}
