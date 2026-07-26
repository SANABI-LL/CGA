// CampusGeo 后端注入脚本
// 端点与 API key 来自 backend-config.local.js（gitignored，见
// backend-config.example.js）；缺省回退到本地 dev-server（无需 key）。
//
// 工作原理：
//   build-with-backend.mjs 给 React bundle 的 submit() 函数打补丁：
//   当 detectKind() 无法识别查询时，不再直接显示本地 fallback，
//   而是调用 window.__cgBackend(q, reactSetters)。
//   本脚本注册该函数，调用 Lambda，把 AI 回答写回 React 主界面。

(function () {
  'use strict';

  const cfg = window.CAMPUSGEO_CONFIG || {};
  const API_BASE = cfg.apiBase || 'http://localhost:3001';
  const API_KEY = cfg.apiKey || '';

  // ── 轻量 Markdown → HTML 渲染器 ────────────────────────────────────────
  // 处理 Lambda 返回的 AI 回答格式：加粗、表格、段落换行、斜体、行内代码。
  // 不引入第三方库，仅覆盖实际输出中出现的语法。
  function mdToHtml(md) {
    // 安全：转义 HTML 特殊字符（dangerouslySetInnerHTML 信任我们输出的 HTML）
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const lines = md.split('\n');
    const out = [];
    let inTable = false;
    let tableRows = [];

    function flushTable() {
      if (!tableRows.length) return;
      const html = [
        '<table style="border-collapse:collapse;width:100%;font-size:13px;margin:12px 0">',
        ...tableRows,
        '</table>',
      ].join('');
      out.push(html);
      tableRows = [];
      inTable = false;
    }

    function inlineFormat(s) {
      return s
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code style="font-family:\'IBM Plex Mono\',monospace;font-size:0.92em;background:#f0ece0;padding:1px 4px;border-radius:3px">$1</code>');
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 表格行
      if (/^\s*\|/.test(line)) {
        inTable = true;
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        // 分隔行（--- / :-:）跳过
        if (cells.every((c) => /^[-: ]+$/.test(c))) continue;
        const isHeader = tableRows.length === 0;
        const tag = isHeader ? 'th' : 'td';
        const style = isHeader
          ? 'border-bottom:2px solid #d4cfc0;padding:6px 10px;text-align:left;font-weight:600;color:#1a1a1a;background:#f4f1ea'
          : 'border-bottom:1px solid #e8e3d6;padding:5px 10px;color:#4a4a48;vertical-align:top';
        tableRows.push('<tr>' + cells.map((c) => `<${tag} style="${style}">${inlineFormat(esc(c))}</${tag}>`).join('') + '</tr>');
        continue;
      }

      // 当前行不是表格行，先 flush 已有表格
      if (inTable) flushTable();

      // 空行
      if (!line.trim()) {
        if (out.length && !out[out.length - 1].endsWith('</p>') && !out[out.length - 1].endsWith('</ul>') && !out[out.length - 1].endsWith('</ol>')) {
          // 已经是块级元素结尾，不加额外间距
        }
        continue;
      }

      // 无序列表
      const ulMatch = line.match(/^[\s]*[-*]\s+(.*)/);
      if (ulMatch) {
        // 简单处理：单项追加（不合并相邻列表项）
        out.push(`<li style="margin:3px 0;color:#4a4a48">${inlineFormat(esc(ulMatch[1]))}</li>`);
        continue;
      }

      // 普通段落
      out.push(`<p style="margin:0 0 8px">${inlineFormat(esc(line))}</p>`);
    }

    if (inTable) flushTable();

    // 把相邻 <li> 包进 <ul>
    const html = out.join('\n')
      .replace(/(<li[^>]*>[\s\S]*?<\/li>\n?)+/g,
        (m) => `<ul style="margin:6px 0 10px;padding-left:18px">${m}</ul>`);

    return html;
  }

  // ── 背景建筑层预加载 ────────────────────────────────────────────────────
  // 页面加载后立即从 Lambda 拉取 buildings.geojson（最多 500 条，有 1h CDN 缓存）。
  // trees / nearby 查询构建 sc 时用作 allData 背景层。

  // buildings.geojson 的两个问题：
  // 1. 坐标带 Z 值（高程 ~2e-5），MapLibre 2D 静默失败
  // 2. 几何类型为 MultiPolygon，MapLibre GeoJSON worker 对此版本无法正确 tile 化
  // 修复：strip2D 剥 Z 值，然后把每个 MultiPolygon 展平为独立 Polygon feature
  function strip2D(coords) {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === 'number') return coords.slice(0, 2);
    return coords.map(strip2D);
  }
  function stripZ(geojson) {
    if (!geojson || !geojson.features) return geojson;
    const flatFeatures = geojson.features.flatMap((f) => {
      if (!f.geometry || !f.geometry.coordinates) return [f];
      if (f.geometry.type === 'MultiPolygon') {
        return f.geometry.coordinates.map((polyCoords) => ({
          type: 'Feature',
          properties: f.properties,
          geometry: { type: 'Polygon', coordinates: strip2D(polyCoords) },
        }));
      }
      return [{ ...f, geometry: { ...f.geometry, coordinates: strip2D(f.geometry.coordinates) } }];
    });
    return { ...geojson, features: flatFeatures };
  }

  let cachedBuildings = null;
  async function preloadBuildings() {
    // 最多重试 3 次（间隔 3s），应对 Lambda cold start 导致的首次超时
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
        const resp = await fetch(`${API_BASE}/api/agent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
          },
          body: JSON.stringify({ layerData: 'buildings' }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data && data.features) {
          cachedBuildings = stripZ(data);
          console.log('[CampusGeo] Buildings preloaded:', data.features.length, 'features');
          return;
        }
      } catch (err) {
        console.warn('[CampusGeo] Buildings preload attempt', attempt + 1, 'failed:', err.message);
      }
    }
  }
  preloadBuildings();

  // ── AI 查询核心 ─────────────────────────────────────────────────────────
  // 被 React submit() 调用。reactSetters 是 { setUnrecMsg, setSubmitted,
  // setQuery, setPhase }，由 build-with-backend.mjs patch 传入。
  async function callAIBackend(userQuery, reactSetters) {
    const { setUnrecMsg, setSubmitted, setQuery, setPhase, setSc, setTitle, setFitCmd } = reactSetters;

    // 立即切换到 unrecognized 面板并显示 loading 动画
    setSubmitted(userQuery);
    setQuery('');
    setUnrecMsg(
      '<style>' +
        '@keyframes __cgBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}' +
        '@keyframes __cgPulse{0%,100%{opacity:0.35}50%{opacity:1}}' +
        '.__cg-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#8C7A60;margin:0 3px;animation:__cgBounce 1.2s ease-in-out infinite}' +
        '.__cg-dot:nth-child(2){animation-delay:0.15s}.__cg-dot:nth-child(3){animation-delay:0.3s}' +
        '.__cg-status{font-size:12px;color:#8C7A60;letter-spacing:0.04em;animation:__cgPulse 1.8s ease-in-out infinite;margin-top:10px}' +
      '</style>' +
      '<div style="display:flex;flex-direction:column;align-items:center;padding:18px 0 6px">' +
        '<div><span class="__cg-dot"></span><span class="__cg-dot"></span><span class="__cg-dot"></span></div>' +
        '<div class="__cg-status">Querying campus data…</div>' +
      '</div>'
    );
    setPhase('unrecognized');

    console.log('[CampusGeo] AI query:', userQuery);

    try {
      const response = await fetch(`${API_BASE}/api/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
        },
        body: JSON.stringify({ query: userQuery, sessionId: 'frontend-' + Date.now() }),
      });

      if (!response.ok) {
        setUnrecMsg(`Backend error: HTTP ${response.status}. Check API key or server.`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let aiText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }

          console.log('[CampusGeo] Event:', event.type, event.toolName || '');

          if (event.type === 'text' && event.content) {
            aiText += event.content;
            // 流式更新：渲染 Markdown 后写入 React 主界面
            setUnrecMsg(mdToHtml(aiText));
          } else if (event.type === 'tool_result' && event.mapUpdate && typeof setSc === 'function') {
            // Lambda 返回了地图数据：存起来，等 AI 文字摘要完整后再切换地图视图
            window.__cgPendingMapUpdate = { mapUpdate: event.mapUpdate, toolName: event.toolName || '', userQuery };
          } else if (event.type === 'error') {
            setUnrecMsg(`Error: ${event.message || 'Unknown error'}`);
            return;
          }
        }
      }

      if (!aiText) setUnrecMsg('No response from AI.');

      // 如果 Lambda 返回了地图数据，在摘要末尾追加 "Map results" 按钮
      if (window.__cgPendingMapUpdate && typeof setSc === 'function') {
        const pending = window.__cgPendingMapUpdate;
        window.__cgPendingMapUpdate = null;

        // 如果 preload 还没完成，立即发一次同步请求
        if (!cachedBuildings) {
          try {
            const r = await fetch(`${API_BASE}/api/agent`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}) },
              body: JSON.stringify({ layerData: 'buildings' }),
            });
            if (r.ok) {
              const d = await r.json();
              if (d && d.features) { cachedBuildings = stripZ(d); console.log('[CampusGeo] Buildings loaded on-demand:', d.features.length); }
            }
          } catch (_) { /* fall through, allData stays empty */ }
        }

        const mu = pending.mapUpdate;
        // stripZ 展平坐标，并裁掉校园边界外的 feature（buildings.geojson 含少量校外建筑）
        const CAMPUS_BBOX = { minLng: -87.63, maxLng: -87.56, minLat: 41.77, maxLat: 41.81 };
        function inCampus(f) {
          if (!f.geometry) return false;
          const c = f.geometry.coordinates;
          let pt = null;
          try {
            if (f.geometry.type === 'Polygon') pt = c && c[0] && c[0][0];
            else if (f.geometry.type === 'MultiPolygon') pt = c && c[0] && c[0][0] && c[0][0][0];
            else if (f.geometry.type === 'Point') pt = c;
          } catch (_) { return true; }
          if (!pt || typeof pt[0] !== 'number') return true;
          return pt[0] >= CAMPUS_BBOX.minLng && pt[0] <= CAMPUS_BBOX.maxLng &&
                 pt[1] >= CAMPUS_BBOX.minLat && pt[1] <= CAMPUS_BBOX.maxLat;
        }
        const rawFc = mu.features || mu;
        const strippedFc = stripZ(rawFc);
        const features = strippedFc && strippedFc.features
          ? { ...strippedFc, features: strippedFc.features.filter(inCampus) }
          : strippedFc;
        const isTree = pending.toolName.includes('tree');
        const featureCount = (features.features || []).length;

        // 判断是否为「年份渐变」查询：含 age / year / built / gradient 等关键词
        const q = pending.userQuery.toLowerCase();
        const isYearGradient = !isTree && /\b(age|year|built|gradient|era|decade|old|new|recent|historic)\b/.test(q);

        // 自适应 title：年份渐变时用描述性标题
        const mapTitle = isYearGradient
          ? 'Building Age — Year Completed'
          : pending.userQuery;

        // legend：年份渐变时显示色阶，树/其他建筑保持原逻辑
        const legend = isYearGradient
          ? [
              { color: '#2166ac', label: 'Pre-1920 (historic)' },
              { color: '#74add1', label: '1920–1960' },
              { color: '#a6d96a', label: '1960–1990' },
              { color: '#fdae61', label: '1990–2010' },
              { color: '#d73027', label: '2010–present' },
              { color: '#888888', label: 'Year unknown', sub: true },
            ]
          : [
              { color: isTree ? '#5A7A3A' : '#800000', label: pending.userQuery.slice(0, 40), round: isTree },
              { color: '#C9BCA6', label: 'Campus context', sub: true },
            ];

        const sc = {
          kind: isTree ? 'trees' : 'buildings',
          unit: isTree ? 'trees' : 'features',
          title: mapTitle,
          data: features,
          allData: { type: 'FeatureCollection', features: [] },
          ctxBuildings: cachedBuildings || { type: 'FeatureCollection', features: [] },
          matchCount: featureCount,
          recordCount: featureCount,
          fieldCount: 3,
          chip: isTree ? 'Campus Trees' : 'Campus Data',
          chipIcon: isTree ? 'leaf' : 'building',
          center: mu.center ? [mu.center.lng, mu.center.lat] : [-87.5987, 41.7886],
          zoom: mu.zoom || 15,
          legend,
          legendSquare: !isTree,
        };

        // 注册按钮回调（闭包持有 React setters）
        window.__cgShowMapBtn = function () {
          if (typeof setTitle === 'function') setTitle(mapTitle);
          setSc(sc);
          setPhase('composing');
          if (typeof setFitCmd === 'function') {
            setTimeout(() => setFitCmd({ ts: Date.now() }), 300);
          }
        };

        const count = (features.features || []).length;
        const btnHtml =
          '<div style="margin-top:18px;padding-top:14px;border-top:1px solid #d4cfc0">' +
            '<button onclick="window.__cgShowMapBtn()" style="' +
              'font-family:\'IBM Plex Sans\',sans-serif;font-size:13px;font-weight:500;' +
              'color:#f4f1ea;background:#800000;border:none;cursor:pointer;' +
              'padding:7px 16px;border-radius:2px;letter-spacing:0.01em' +
            '">Map results</button>' +
            '<span style="margin-left:10px;font-size:12px;color:#8a8a85;font-family:\'IBM Plex Mono\',monospace">' +
              count + ' feature' + (count !== 1 ? 's' : '') +
            '</span>' +
          '</div>';

        setUnrecMsg((prev) => {
          const base = typeof prev === 'string' ? prev : mdToHtml(aiText);
          return base + btnHtml;
        });
      }

      console.log('[CampusGeo] Query complete');
    } catch (err) {
      console.error('[CampusGeo] Fetch error:', err);
      setUnrecMsg(`Connection failed: ${err.message}. Check backend-config.local.js and server.`);
    }
  }

  // 注册为全局函数，供 build-with-backend.mjs patch 后的 submit() 调用
  window.__cgBackend = callAIBackend;

  // 判断查询是否为地图/打印请求——这类查询交还本地引擎处理（MapLibre 渲染）
  window.__cgIsMapQuery = function (q) {
    return /\b(print|plot|layer|scale)\b/i.test(q) || /\bon (a |the )?(map|screen|canvas)\b/i.test(q);
  };

  // 供调试用：window.testBackend("query") 仍可在 console 里使用
  // （此时没有 React setters，只打印流式响应到 console）
  window.testBackend = function (query) {
    const fakeSetters = {
      setUnrecMsg: (v) => console.log('[testBackend] msg:', typeof v === 'string' ? v.slice(0, 120) : v),
      setSubmitted: (v) => console.log('[testBackend] submitted:', v),
      setQuery: () => {},
      setPhase: (v) => console.log('[testBackend] phase:', v),
    };
    return callAIBackend(query || 'How many trees on campus?', fakeSetters);
  };

  // ── 数据溯源面板真数据 ──────────────────────────────────────────────────
  // 拉取后端 freshness 报告，填充 window.CAMPUSGEO_LIVE。
  // bundle 里的演示常量已被 build-with-backend.mjs 改为优先读取该对象。
  async function loadFreshness() {
    try {
      const response = await fetch(`${API_BASE}/api/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { 'X-Api-Key': API_KEY } : {}),
        },
        body: JSON.stringify({ freshness: true }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const d = await response.json();

      const fmt = (dt) =>
        dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
      const rel = (dt) => {
        const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
        return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
      };

      const gen = d.lastRunAt ? new Date(d.lastRunAt) : null;
      const hist = d.history && d.history.length
        ? d.history
        : gen
          ? [{
              generatedAt: d.lastRunAt,
              status: d.items && d.items.length ? 'applied' : 'skipped',
              summary: d.items && d.items.length
                ? d.items.map((i) => i.headline).join(' · ')
                : 'No changes detected since the previous run',
            }]
          : [];

      const nowCT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      const next = new Date(nowCT);
      next.setHours(2, 0, 0, 0);
      if (next <= nowCT) next.setDate(next.getDate() + 1);
      const hoursToNext = Math.max(1, Math.round((next - nowCT) / 3600000));

      window.CAMPUSGEO_LIVE = {
        syncSource: { name: 'UChicago Campus GIS', type: 'Self-hosted GeoJSON on S3', layers: d.layersTracked },
        syncLog: hist.slice(0, 5).map((h) => {
          const dt = new Date(h.generatedAt);
          return { date: fmt(dt), rel: rel(dt), summary: h.summary, status: h.status || 'applied' };
        }),
        syncLogLabel: `last ${Math.min(5, hist.length)} of ${hist.length} run${hist.length !== 1 ? 's' : ''}`,
        digestDate: d.date || undefined,
        digestItems: d.items && d.items.length
          ? d.items
          : gen
            ? [{ icon: 'diff', headline: 'No changes in the latest sync',
                detail: `Nightly diff ran ${fmt(gen)} — no layer changes detected.`,
                sub: `${d.layersTracked} layers checked` }]
            : undefined,
        currentAsOf: gen ? `Campus data is current as of ${fmt(gen)}, 02:00 CT.` : undefined,
        nextRunIn: `≈ ${hoursToNext} h`,
      };
      console.log('[CampusGeo] Freshness loaded:', d.layersTracked, 'layers, last run', d.lastRunAt);
    } catch (err) {
      console.warn('[CampusGeo] Freshness unavailable, panel keeps demo data:', err.message);
    }
  }

  loadFreshness();
  window.reloadFreshness = loadFreshness;

  console.log('[CampusGeo] inject-backend ready. Test: window.testBackend("your query")');
})();
