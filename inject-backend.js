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

  // 全局 HTML 转义——所有外部数据（LLM 文本、SSE 字段、S3 属性）插入 HTML 前必须经过此函数
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // 演示数据角标：cfg.isDemo = true 时在右上角显示固定标注，
  // 防止演示时听众误将假数据当作真实数据。
  if (cfg.isDemo === true) {
    const badge = document.createElement('div');
    badge.id = '__cg-demo-badge';
    badge.textContent = 'DEMO DATA';
    badge.style.cssText =
      'position:fixed;top:10px;right:12px;z-index:9998;' +
      'font-family:"Gotham",monospace;font-size:10px;font-weight:700;' +
      'letter-spacing:0.08em;color:#f4f1ea;background:#8C7A60;' +
      'padding:3px 8px;border-radius:2px;pointer-events:none;' +
      'opacity:0.85;';
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.getElementById('__cg-demo-badge')) document.body.appendChild(badge);
    });
    if (document.readyState !== 'loading') {
      if (!document.getElementById('__cg-demo-badge')) document.body.appendChild(badge);
    }
  }

  // ── 轻量 Markdown → HTML 渲染器 ────────────────────────────────────────
  // 处理 Lambda 返回的 AI 回答格式：加粗、表格、段落换行、斜体、行内代码。
  // 不引入第三方库，仅覆盖实际输出中出现的语法。
  function mdToHtml(md) {

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
        .replace(/`(.+?)`/g, '<code style="font-family:\'Gotham\',monospace;font-size:0.92em;background:#f0ece0;padding:1px 4px;border-radius:3px">$1</code>');
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

  // ── PDF export ──────────────────────────────────────────────────────────
  window.__cgPrintReport = function () {
    const el = document.getElementById('__cg-report-content');
    if (!el) return;
    const win = window.open('', '_blank', 'width=800,height=1000');
    win.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>CampusGeo Report</title>' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gotham:opsz,wght@9..144,400;9..144,500&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono&display=swap">' +
      '<style>' +
        'body { font-family: "Gotham", sans-serif; max-width: 700px; margin: 40px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.6; }' +
        'h1,h2,h3 { font-family: Gotham, serif; }' +
        'hr { border: none; border-top: 1px solid #d4cfc0; margin: 14px 0; }' +
        'table { border-collapse: collapse; width: 100%; margin: 12px 0; }' +
        'th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #d4cfc0; font-size: 13px; }' +
        'th { font-weight: 500; color: #4a4a48; }' +
        'button { display: none; }' +
        '@media print { body { margin: 20px; } }' +
      '</style></head><body>' +
      el.innerHTML +
      '</body></html>'
    );
    win.document.close();
    setTimeout(() => { win.print(); }, 600);
  };

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

  // ── 工具调用可视化 ──────────────────────────────────────────────────────
  // 把 agent 的多步推理过程以终端日志风格呈现，让用户看见"思考链"

  const TOOL_META = {
    'query_building_attributes': 'Searching buildings database',
    'query_trees':               'Searching tree inventory',
    'find_campus_nearby':        'Finding nearby features',
    'get_building_info':         'Looking up building record',
    'search_planning_documents': 'Scanning planning documents',
    'get_data_freshness':        'Checking data freshness',
    'get_shuttle_arrivals':      'Fetching shuttle schedule',
    'get_bike_stations':         'Checking Divvy stations',
    'check_hours':               'Checking hours of operation',
    'query_campus_utilities':    'Querying campus utilities',
  };

  // ── Trace UI ────────────────────────────────────────────────────────────
  // 共享 keyframes + 基础类（每次调用都内联，React dangerouslySetInnerHTML 无全局 <head>）
  var __cgTrStyleBlock = (
    '<style id="__cg-tr-styles">' +
    // 进入动画：从左侧微移淡入
    '@keyframes __cgTrIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}' +
    // pending 图标脉冲（柔和呼吸感）
    '@keyframes __cgTrBreath{0%,100%{opacity:0.25;transform:scale(0.85)}50%{opacity:1;transform:scale(1)}}' +
    // 扫描横线（pending 行背景）
    '@keyframes __cgTrScan{0%{background-position:200% 0}100%{background-position:-200% 0}}' +
    // 打点动画（Composing 行）
    '@keyframes __cgTrDot{0%,80%,100%{transform:translateY(0);opacity:0.3}40%{transform:translateY(-3px);opacity:1}}' +
    // 完成行缩进淡出（颜色从深→浅）
    '@keyframes __cgTrDone{from{color:#4a4a48}to{color:#8a8a85}}' +
    // 竖线脉冲
    '@keyframes __cgBarPulse{0%,100%{opacity:0.4}50%{opacity:1}}' +
    // 容器
    '.__cg-tr{padding:12px 0 12px 16px;margin:6px 0 2px;position:relative}' +
    // 竖线：动态脉冲，完成后变静态
    '.__cg-tr-bar{position:absolute;left:0;top:0;bottom:0;width:2px;background:#d4cfc0;border-radius:1px}' +
    '.__cg-tr-bar.pulsing{background:linear-gradient(180deg,#8C7A60 0%,#d4cfc0 60%);animation:__cgBarPulse 1.8s ease-in-out infinite}' +
    // 行
    '.__cg-tr-row{display:flex;align-items:center;gap:10px;font-family:"Gotham",monospace;font-size:12px;padding:5px 0;animation:__cgTrIn 0.22s cubic-bezier(0.4,0,0.2,1) both}' +
    // pending 行：背景扫描光
    '.__cg-tr-row.pend{background:linear-gradient(90deg,transparent 30%,rgba(140,122,96,0.06) 50%,transparent 70%);background-size:200% 100%;animation:__cgTrIn 0.22s cubic-bezier(0.4,0,0.2,1) both,__cgTrScan 2.2s linear infinite}' +
    // pending 图标（呼吸点）
    '.__cg-ic-p{width:8px;height:8px;border-radius:50%;background:#8C7A60;flex-shrink:0;animation:__cgTrBreath 1.6s ease-in-out infinite}' +
    // done 图标（绿勾，scale in）
    '.__cg-ic-d{width:14px;text-align:center;color:#5a9a6e;flex-shrink:0;font-size:11px}' +
    // pending 标签
    '.__cg-lbl-p{color:#4a4a48;letter-spacing:0.01em;flex:1}' +
    // done 标签（淡化）
    '.__cg-lbl-d{color:#9a9690;flex:1;text-decoration:none}' +
    // 结果数量（右侧）
    '.__cg-tr-res{color:#7a9a7e;font-size:11px;padding-left:12px;white-space:nowrap;opacity:0;animation:__cgTrIn 0.3s 0.1s ease both,__cgTrDone 0s forwards}' +
    // 小计时器标签
    '.__cg-tr-ms{color:#b5ada0;font-size:10px;padding-left:8px;white-space:nowrap}' +
    // Composing 行的三个点
    '.__cg-dots span{display:inline-block;width:4px;height:4px;border-radius:50%;background:#8C7A60;margin:0 1.5px;animation:__cgTrDot 1.2s ease-in-out infinite}' +
    '.__cg-dots span:nth-child(2){animation-delay:0.2s}' +
    '.__cg-dots span:nth-child(3){animation-delay:0.4s}' +
    '</style>'
  );

  // 步骤开始时间戳（用于显示耗时）
  var __cgStepTimers = {};

  // 完整 trace（工具进行中）
  function buildTraceHtml(steps, composing) {
    var hasPending = steps.some(function(s) { return s.status === 'pending'; });
    var rows = steps.map(function(step, i) {
      var pending = step.status === 'pending';
      var label = esc(TOOL_META[step.toolName] || step.toolName.replace(/_/g, ' '));
      var elapsed = '';
      if (!pending && __cgStepTimers[step.toolName + '_' + i]) {
        var ms = Date.now() - __cgStepTimers[step.toolName + '_' + i];
        elapsed = '<span class="__cg-tr-ms">' + (ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's') + '</span>';
      }
      var res = step.resultSummary
        ? '<span class="__cg-tr-res">' + esc(step.resultSummary) + '</span>'
        : '';
      if (pending) {
        return (
          '<div class="__cg-tr-row pend" style="animation-delay:' + (i * 0.07) + 's">' +
            '<span class="__cg-ic-p" style="animation-delay:' + (i * 0.3) + 's"></span>' +
            '<span class="__cg-lbl-p">' + label + '</span>' +
          '</div>'
        );
      } else {
        return (
          '<div class="__cg-tr-row" style="animation-delay:' + (i * 0.07) + 's">' +
            '<span class="__cg-ic-d">✓</span>' +
            '<span class="__cg-lbl-d">' + label + '</span>' +
            res + elapsed +
          '</div>'
        );
      }
    }).join('');

    // 初始占位行：还没有任何工具调用
    var initialRow = (!steps.length && !composing)
      ? '<div class="__cg-tr-row pend">' +
          '<span class="__cg-ic-p"></span>' +
          '<span class="__cg-lbl-p">Reading your query</span>' +
        '</div>'
      : '';

    // Composing 行：工具完成后、文字流式前
    var composingRow = composing
      ? '<div class="__cg-tr-row" style="animation-delay:' + (steps.length * 0.07) + 's;gap:8px">' +
          '<span class="__cg-dots"><span></span><span></span><span></span></span>' +
          '<span class="__cg-lbl-p" style="color:#6a6a65">Composing answer</span>' +
        '</div>'
      : '';

    var barClass = (hasPending || composing || !steps.length) ? '__cg-tr-bar pulsing' : '__cg-tr-bar';
    return (
      __cgTrStyleBlock +
      '<div class="__cg-tr">' +
        '<div class="' + barClass + '"></div>' +
        initialRow + rows + composingRow +
      '</div>'
    );
  }

  // 折叠 header（AI 文字开始后显示在正文上方）
  function buildTraceHeaderHtml(steps) {
    var done = steps.filter(function(s) { return s.status === 'done'; });
    if (!done.length) return '';
    var totalFeatures = done.reduce(function(n, s) { return n + (s.featureCount || 0); }, 0);
    var seen = {}, labels = [];
    done.forEach(function(s) {
      var l = TOOL_META[s.toolName] || s.toolName;
      if (!seen[l]) { seen[l] = 1; labels.push(l); }
    });
    var label = labels.length <= 2 ? labels.map(esc).join(' · ') : (labels.length + ' data queries');
    var featStr = totalFeatures ? ' · ' + totalFeatures + ' feature' + (totalFeatures !== 1 ? 's' : '') : '';
    // 每个工具名一个小芯片
    var chips = labels.map(function(l) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;padding:1px 7px;' +
        'border-radius:2px;border:1px solid #d4cfc0;color:#8a8a85;margin-right:5px;' +
        'font-size:10px;letter-spacing:0.02em">' + esc(l) + '</span>';
    }).join('');
    return (
      '<div style="font-family:\'Gotham\',monospace;display:flex;flex-wrap:wrap;align-items:center;gap:4px;' +
        'margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid #d4cfc0;' +
        'animation:__cgTrIn 0.3s ease both">' +
        chips +
        (featStr ? '<span style="font-size:11px;color:#b5ada0;margin-left:2px">' + esc(featStr) + '</span>' : '') +
      '</div>'
    );
  }

  // ── AI 查询核心 ─────────────────────────────────────────────────────────
  // 被 React submit() 调用。reactSetters 是 { setUnrecMsg, setSubmitted,
  // setQuery, setPhase }，由 build-with-backend.mjs patch 传入。
  async function callAIBackend(userQuery, reactSetters) {
    const { setUnrecMsg, setSubmitted, setQuery, setPhase, setSc, setTitle, setFitCmd } = reactSetters;

    // Clean up any lingering back button from previous map view
    const oldBackBtn = document.getElementById('__cg-back-btn');
    if (oldBackBtn) oldBackBtn.remove();

    // 立即切换到 unrecognized 面板并显示 trace UI（工具调用可视化）
    setSubmitted(userQuery);
    setQuery('');
    var traceSteps = [];          // {toolName, status:'pending'|'done', resultSummary, featureCount}
    var textStarted = false;      // 第一个 text 事件后切换到 header 模式
    setUnrecMsg(buildTraceHtml(traceSteps, false));
    setPhase('unrecognized');

    console.log('[CampusGeo] AI query:', userQuery);
    window.__cgPendingMapUpdate = null;

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

          if (event.type === 'tool_call' && event.toolName) {
            // 新工具被调用：追加一个 pending 步骤，记录开始时间
            var stepIdx = traceSteps.length;
            __cgStepTimers[event.toolName + '_' + stepIdx] = Date.now();
            traceSteps.push({ toolName: event.toolName, status: 'pending' });
            setUnrecMsg(buildTraceHtml(traceSteps, false));

          } else if (event.type === 'text' && event.content) {
            aiText += event.content;
            if (!textStarted) {
              // 第一个文字流：trace 折叠为 header，正文开始
              textStarted = true;
            }
            // trace header + 正文 Markdown
            setUnrecMsg(buildTraceHeaderHtml(traceSteps) + mdToHtml(aiText));

          } else if (event.type === 'tool_result') {
            // 把对应 pending 步骤标记为 done，附加结果摘要
            var tn = event.toolName || '';
            var pendingIdx = -1;
            for (var pi = traceSteps.length - 1; pi >= 0; pi--) {
              if (traceSteps[pi].toolName === tn && traceSteps[pi].status === 'pending') {
                pendingIdx = pi; break;
              }
            }
            if (pendingIdx >= 0) {
              var fc = event.mapUpdate && event.mapUpdate.features && event.mapUpdate.features.features;
              var cnt = fc ? fc.length : 0;
              traceSteps[pendingIdx].status = 'done';
              traceSteps[pendingIdx].featureCount = cnt;
              traceSteps[pendingIdx].resultSummary = cnt
                ? cnt + ' feature' + (cnt !== 1 ? 's' : '')
                : (event.data && event.data.error ? 'error' : 'done');
              // 所有工具完成但文字还没开始 → 显示 "Composing summary"
              var allDone = traceSteps.every(function(s) { return s.status === 'done'; });
              setUnrecMsg(buildTraceHtml(traceSteps, allDone && !textStarted));
            }

            if (event.mapUpdate && typeof setSc === 'function') {
              if (!window.__cgPendingMapUpdate) {
                window.__cgPendingMapUpdate = { mapUpdate: event.mapUpdate, toolName: event.toolName || '', userQuery };
              } else {
                // 多次工具调用（如多建筑师查询）：合并 features
                var prevMu = window.__cgPendingMapUpdate.mapUpdate;
                var newMu = event.mapUpdate;
                var prevFc2 = prevMu.features || prevMu;
                var newFc2 = newMu.features || newMu;
                if (prevFc2 && prevFc2.features && newFc2 && newFc2.features) {
                  prevFc2.features = prevFc2.features.concat(newFc2.features);
                }
                window.__cgPendingMapUpdate.toolName = event.toolName || window.__cgPendingMapUpdate.toolName;
              }
            }
          } else if (event.type === 'error') {
            setUnrecMsg(`Error: ${event.message || 'Unknown error'}`);
            return;
          }
        }
      }

      if (!aiText) setUnrecMsg('No response from AI.');

      // Append "Save as PDF" for text-only responses (no map data)
      if (aiText && !window.__cgPendingMapUpdate) {
        const pdfBtn =
          '<div style="margin-top:18px;padding-top:14px;border-top:1px solid #d4cfc0">' +
            '<button onclick="window.__cgPrintReport()" style="' +
              'font-family:\'Gotham\',sans-serif;font-size:13px;font-weight:500;' +
              'color:#4a4a48;background:none;border:1px solid #d4cfc0;cursor:pointer;' +
              'padding:7px 16px;border-radius:2px;letter-spacing:0.01em' +
            '">Save as PDF</button>' +
          '</div>';
        setUnrecMsg((prev) => {
          const base = typeof prev === 'string' ? prev : mdToHtml(aiText);
          return base + pdfBtn;
        });
      }

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
        // Point 要素检测（bike rack、parking 等 nearby 查询）—— 用 features（已定义）
        const firstGeomType = features && features.features && features.features[0]
          ? (features.features[0].geometry && features.features[0].geometry.type)
          : null;
        const isPointLayer = firstGeomType === 'Point' || firstGeomType === 'MultiPoint';
        // Point 要素渐变配色：找数值字段（Spaces / Count 等），计算实际值域
        let pointColorField = null;
        let pointMin = 0;
        let pointMax = 1;
        if (isPointLayer && features && features.features && features.features.length) {
          const _fp = features.features[0].properties || {};
          for (const _c of ['Spaces', 'spaces', 'Count', 'count', 'Capacity', 'capacity', 'SPACES']) {
            if (typeof _fp[_c] === 'number') {
              pointColorField = _c;
              const _vals = features.features.map(f => Number((f.properties || {})[_c] || 0)).filter(v => v > 0);
              pointMin = Math.min.apply(null, _vals);
              pointMax = Math.max.apply(null, _vals);
              if (pointMax <= pointMin) pointMax = pointMin + 1;
              break;
            }
          }
        }

        const q = pending.userQuery.toLowerCase();
        const isYearGradient = !isTree && /\b(age|year|built|gradient|era|decade|old|new|recent|historic)\b/.test(q);
        const isArchitectQuery = !isTree && /\b(architect|designer|firm|designed by|built by)\b/.test(q);

        // 建筑师查询：规范化分组（处理 S3 数据里同一事务所的多种拼写变体）
        const ARCH_COLORS = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#e67e22', '#16a085'];

        let archValues = [];
        let coloredFeatures = features;
        let archGroupLegend = [];  // [{color, label}] 去重后的图例
        if (isArchitectQuery && features.features && features.features.length) {
          function normArch(name) {
            return name.toLowerCase()
              .replace(/[^a-z ]/g, ' ')
              .replace(/\b(and|the|of|associates?)\b/g, '')
              .split(/\s+/).filter(Boolean).sort().join(' ');
          }

          function editDist(a, b) {
            if (a === b) return 0;
            if (a.length > b.length) { const t = a; a = b; b = t; }
            const row = Array.from({ length: a.length + 1 }, (_, i) => i);
            for (let j = 1; j <= b.length; j++) {
              let prev = row[0]; row[0] = j;
              for (let i = 1; i <= a.length; i++) {
                const tmp = row[i];
                row[i] = a[i-1] === b[j-1] ? prev : 1 + Math.min(prev, row[i], row[i-1]);
                prev = tmp;
              }
            }
            return row[a.length];
          }

          function tokensFuzzyMatch(ta, tb) {
            const fuzzy = (s, t) => s === t || (s.length > 3 && t.length > 3 && editDist(s, t) <= 1);
            const shorter = ta.length <= tb.length ? ta : tb;
            const longer = ta.length <= tb.length ? tb : ta;
            const matched = shorter.filter(s => longer.some(t => fuzzy(s, t)));
            return matched.length === shorter.length;
          }

          // Group raw Architects values by normalized key
          const normToRaws = {};
          features.features.forEach((f) => {
            const a = (f.properties && (f.properties.Architects || f.properties.architect || '')).trim();
            if (!a) return;
            const key = normArch(a);
            if (!normToRaws[key]) normToRaws[key] = [];
            if (!normToRaws[key].includes(a)) normToRaws[key].push(a);
          });

          // Fuzzy merge: merge keys whose tokens are subsets with edit-distance ≤ 1
          const rawKeys = Object.keys(normToRaws);
          const canonical = {};  // key → canonical representative
          rawKeys.forEach(k => { canonical[k] = k; });
          for (let i = 0; i < rawKeys.length; i++) {
            for (let j = i + 1; j < rawKeys.length; j++) {
              const a = rawKeys[i], b = rawKeys[j];
              let ca = a, cb = b;
              while (canonical[ca] !== ca) ca = canonical[ca];
              while (canonical[cb] !== cb) cb = canonical[cb];
              if (ca === cb) continue;
              const ta = a.split(' '), tb = b.split(' ');
              if (tokensFuzzyMatch(ta, tb)) {
                const keep = ta.length >= tb.length ? ca : cb;
                const drop = keep === ca ? cb : ca;
                canonical[drop] = keep;
              }
            }
          }
          // Resolve chains and merge raws
          const mergedGroups = {};
          rawKeys.forEach(k => {
            let c = k;
            while (canonical[c] !== c) c = canonical[c];
            if (!mergedGroups[c]) mergedGroups[c] = [];
            normToRaws[k].forEach(r => { if (!mergedGroups[c].includes(r)) mergedGroups[c].push(r); });
          });

          // Assign one color per merged group
          const firmKeys = Object.keys(mergedGroups);
          const firmColorMap = {};
          const firmLabelMap = {};
          firmKeys.forEach((key, i) => {
            firmColorMap[key] = ARCH_COLORS[i % ARCH_COLORS.length];
            const raws = mergedGroups[key];
            const best = raws.reduce((a, b) => b.length > a.length ? b : a, raws[0]);
            firmLabelMap[key] = best.length > 38 ? best.slice(0, 36) + '…' : best;
          });

          archGroupLegend = firmKeys.map((key) => ({
            color: firmColorMap[key],
            label: firmLabelMap[key],
          }));

          // Resolve any key to its canonical group
          function resolveCanonical(k) {
            let c = k;
            while (canonical[c] !== c) c = canonical[c];
            return c;
          }

          coloredFeatures = {
            ...features,
            features: features.features.map((f) => {
              const a = (f.properties && (f.properties.Architects || f.properties.architect || '')).trim();
              const key = a ? resolveCanonical(normArch(a)) : '';
              return {
                ...f,
                properties: {
                  ...f.properties,
                  _cgColor: (key && firmColorMap[key]) || '#888888',
                },
              };
            }),
          };
          archValues = firmKeys;
        }

        const featureCount = (coloredFeatures.features || []).length;

        // 自适应 title
        const mapTitle = isYearGradient
          ? 'Building Age — Year Completed'
          : isArchitectQuery
            ? 'Buildings by Architects'
            : pending.userQuery;

        // legend
        const legend = isYearGradient
          ? [
              { color: '#2166ac', label: 'Pre-1920 (historic)' },
              { color: '#74add1', label: '1920–1960' },
              { color: '#a6d96a', label: '1960–1990' },
              { color: '#fdae61', label: '1990–2010' },
              { color: '#d73027', label: '2010–present' },
              { color: '#888888', label: 'Year unknown', sub: true },
            ]
          : isPointLayer && pointColorField
            ? [
                { color: '#f4e4c1', label: String(Math.round(pointMin)) + ' ' + pointColorField },
                { color: '#e9b674', label: '' },
                { color: '#c97d3e', label: '' },
                { color: '#8b4513', label: '' },
                { color: '#4a2818', label: String(Math.round(pointMax)) + ' ' + pointColorField, round: true },
              ]
          : isArchitectQuery && archGroupLegend.length
            ? archGroupLegend
            : [
                { color: isTree ? '#5A7A3A' : '#800000', label: pending.userQuery.slice(0, 40), round: isTree },
                { color: '#C9BCA6', label: 'Campus context', sub: true },
              ];

        const sc = {
          kind: isTree ? 'trees' : isPointLayer ? 'nearby' : 'buildings',
          unit: isTree ? 'trees' : isPointLayer ? 'locations' : 'features',
          title: mapTitle,
          data: coloredFeatures,
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
          legendSquare: !isTree && !isPointLayer,
        };

        // 注册按钮回调（闭包持有 React setters）
        window.__cgShowMapBtn = function () {
          if (typeof setTitle === 'function') setTitle(mapTitle);
          setSc(sc);
          setPhase('composing');
          if (typeof setFitCmd === 'function') {
            setTimeout(() => setFitCmd({ ts: Date.now() }), 300);
          }
          if (isPointLayer) {
            // Point 要素（bike rack、parking 等）：circle 图层 + 数值字段渐变色 + hover tooltip
            (function addPointLayer(attempts) {
              const m = window.__cgMap;
              if (!m || !m.isStyleLoaded()) {
                if (attempts < 30) setTimeout(() => addPointLayer(attempts + 1), 200);
                return;
              }
              // 清除上次遗留的 nearby 层
              if (m.getLayer('nearby-hover')) m.removeLayer('nearby-hover');
              if (m.getLayer('nearby-circle')) m.removeLayer('nearby-circle');
              if (m.getSource('nearby-src')) m.removeSource('nearby-src');
              m.addSource('nearby-src', { type: 'geojson', data: sc.data });

              // 渐变色表达式：有数值字段时按值插值，否则统一栗红
              const colorExpr = pointColorField
                ? ['interpolate', ['linear'], ['to-number', ['get', pointColorField], pointMin],
                    pointMin, '#f4e4c1',
                    pointMin + (pointMax - pointMin) * 0.25, '#e9b674',
                    pointMin + (pointMax - pointMin) * 0.5,  '#c97d3e',
                    pointMin + (pointMax - pointMin) * 0.75, '#8b4513',
                    pointMax, '#4a2818']
                : '#800000';
              // 圆点半径：值大的稍大（6-10px）
              const radiusExpr = pointColorField
                ? ['interpolate', ['linear'], ['to-number', ['get', pointColorField], pointMin],
                    pointMin, 6, pointMax, 10]
                : 7;

              m.addLayer({
                id: 'nearby-circle',
                type: 'circle',
                source: 'nearby-src',
                paint: {
                  'circle-radius': radiusExpr,
                  'circle-color': colorExpr,
                  'circle-opacity': 0.9,
                  'circle-stroke-width': 1.5,
                  'circle-stroke-color': '#3a1a00',
                },
              });

              // hover tooltip
              var nearbyPopup = new window.maplibregl.Popup({
                closeButton: false,
                closeOnClick: false,
                className: '__cg-nearby-popup',
              });
              m.on('mouseenter', 'nearby-circle', function(e) {
                m.getCanvas().style.cursor = 'pointer';
                if (!e.features || !e.features[0]) return;
                var p = e.features[0].properties;
                // 构建 tooltip 内容
                var lines = [];
                if (pointColorField && p[pointColorField] != null) {
                  lines.push('<strong>' + Number(p[pointColorField]) + '</strong> ' + pointColorField);
                }
                if (p['Type']) lines.push(p['Type']);
                if (p['Name']) lines.push(p['Name']);
                if (p['Address']) lines.push(p['Address']);
                if (p['distanceMeters'] != null) lines.push(Math.round(p['distanceMeters']) + ' m away');
                if (!lines.length) lines.push('Feature ' + (p['FID'] || p['OBJECTID'] || ''));
                nearbyPopup
                  .setLngLat(e.features[0].geometry.coordinates)
                  .setHTML(
                    '<div style="font-family:\'Gotham\',sans-serif;font-size:12px;' +
                    'color:#1a1a1a;line-height:1.5;padding:4px 2px">' +
                    lines.join('<br>') + '</div>'
                  )
                  .addTo(m);
              });
              m.on('mouseleave', 'nearby-circle', function() {
                m.getCanvas().style.cursor = '';
                nearbyPopup.remove();
              });
            })(0);
          } else {
            // 动态切换 bldg-hit-fill 着色，确保地图与图例同步
            // 用 retry 轮询等待层加载完毕，避免 150ms 竞态
            (function applyPaint(attempts) {
              const m = window.__cgMap;
              if (!m || !m.getLayer('bldg-hit-fill')) {
                if (attempts < 30) setTimeout(() => applyPaint(attempts + 1), 200);
                return;
              }
              if (isYearGradient) {
                m.setPaintProperty('bldg-hit-fill', 'fill-color',
                  ['interpolate', ['linear'], ['to-number', ['get', 'Year_Completed'], 1900],
                    1890, '#2166ac', 1930, '#74add1', 1960, '#a6d96a', 1990, '#fdae61', 2020, '#d73027']);
                m.setPaintProperty('bldg-hit-fill', 'fill-opacity', 0.72);
              } else {
                // 非年代查询：coalesce(_cgColor, maroon) —— 建筑师分色或统一栗红
                m.setPaintProperty('bldg-hit-fill', 'fill-color',
                  ['coalesce', ['get', '_cgColor'], '#800000']);
                m.setPaintProperty('bldg-hit-fill', 'fill-opacity', 0.34);
              }
            })(0);
          }
          // Inject "Back to report" floating button
          setTimeout(() => {
            if (document.getElementById('__cg-back-btn')) return;
            const btn = document.createElement('button');
            btn.id = '__cg-back-btn';
            btn.textContent = '← Back to report';
            btn.style.cssText =
              'position:fixed;top:16px;left:16px;z-index:9999;' +
              'font-family:"Gotham",sans-serif;font-size:13px;font-weight:500;' +
              'color:#4a4a48;background:#f4f1ea;border:1px solid #d4cfc0;' +
              'padding:8px 14px;border-radius:4px;cursor:pointer;' +
              'box-shadow:0 2px 8px rgba(0,0,0,0.08);transition:background 0.2s';
            btn.onmouseenter = () => { btn.style.background = '#e8e3d6'; };
            btn.onmouseleave = () => { btn.style.background = '#f4f1ea'; };
            btn.onclick = () => {
              setPhase('unrecognized');
              btn.remove();
            };
            document.body.appendChild(btn);
            // Auto-remove when composing view disappears (Cancel/reset)
            const check = setInterval(() => {
              if (!document.getElementById('__cg-back-btn')) { clearInterval(check); return; }
              const printBar = document.querySelector('[data-print-frame]');
              if (!printBar && !document.querySelector('canvas.maplibregl-canvas')) {
                btn.remove();
                clearInterval(check);
              }
            }, 500);
          }, 100);
        };

        // Back-to-report：从地图视图返回文字报告
        window.__cgBackToReport = function () {
          setPhase('unrecognized');
          const btn = document.getElementById('__cg-back-btn');
          if (btn) btn.remove();
        };

        const count = (features.features || []).length;
        const btnHtml =
          '<div style="margin-top:18px;padding-top:14px;border-top:1px solid #d4cfc0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<button onclick="window.__cgShowMapBtn()" style="' +
              'font-family:\'Gotham\',sans-serif;font-size:13px;font-weight:500;' +
              'color:#f4f1ea;background:#800000;border:none;cursor:pointer;' +
              'padding:7px 16px;border-radius:2px;letter-spacing:0.01em' +
            '">Map results</button>' +
            '<button onclick="window.__cgPrintReport()" style="' +
              'font-family:\'Gotham\',sans-serif;font-size:13px;font-weight:500;' +
              'color:#4a4a48;background:none;border:1px solid #d4cfc0;cursor:pointer;' +
              'padding:7px 16px;border-radius:2px;letter-spacing:0.01em' +
            '">Save as PDF</button>' +
            '<span style="font-size:12px;color:#8a8a85;font-family:\'Gotham\',monospace">' +
              count + ' feature' + (count !== 1 ? 's' : '') +
            '</span>' +
          '</div>';

        // For architect queries, build a complete roster grouped by firm
        let archRosterHtml = '';
        if (isArchitectQuery && archGroupLegend.length && coloredFeatures.features) {
          const groupedNames = {};
          archGroupLegend.forEach(g => { groupedNames[g.label] = { color: g.color, names: [] }; });
          coloredFeatures.features.forEach(f => {
            const name = (f.properties && (f.properties.DISCRIPT1 || f.properties.name || '')).trim();
            const color = (f.properties && f.properties._cgColor) || '#888888';
            const group = archGroupLegend.find(g => g.color === color);
            if (group && name && !groupedNames[group.label].names.includes(name)) {
              groupedNames[group.label].names.push(name);
            }
          });
          const sections = Object.entries(groupedNames).map(([label, g]) => {
            const swatch = '<span style="display:inline-block;width:12px;height:12px;background:' +
              esc(g.color) + ';margin-right:8px;vertical-align:middle;border-radius:1px"></span>';
            const heading = '<h3 style="font-family:Gotham,serif;font-size:18px;margin:18px 0 8px;font-weight:500">' +
              swatch + esc(label) + ' — ' + g.names.length + ' building' + (g.names.length !== 1 ? 's' : '') + '</h3>';
            const list = g.names.map(n =>
              '<div style="font-family:\'Gotham\',sans-serif;font-size:14px;color:#1a1a1a;padding:3px 0 3px 20px">' + esc(n) + '</div>'
            ).join('');
            return heading + list;
          }).join('<hr style="border:none;border-top:1px solid #d4cfc0;margin:14px 0">');
          archRosterHtml = '<div style="margin-top:18px;padding-top:14px;border-top:1px solid #d4cfc0">' +
            '<p style="font-family:Gotham,serif;font-size:24px;line-height:1.15;margin:0 0 8px;font-weight:400">' +
              count + ' buildings across ' + archGroupLegend.length + ' firm' + (archGroupLegend.length !== 1 ? 's' : '') +
            '</p>' + sections + '</div>';
        }

        setUnrecMsg((prev) => {
          const base = typeof prev === 'string' ? prev : mdToHtml(aiText);
          return base + archRosterHtml + btnHtml;
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
  // 只拦截明确的打印/渲染操作指令，不拦截含 "layer" 的一般提问
  window.__cgIsMapQuery = function (q) {
    return /\b(print|plot)\b/i.test(q) && /\b(map|layout|scale|paper)\b/i.test(q);
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

  // ── Landing page 跳转自动触发查询 ──────────────────────────────────────────
  // landing page 通过 ?q=<encoded> 传递初始查询。
  // React 应用需要约 500ms 完成挂载，用 poll 等待 __cgBackend 就绪后再触发。
  (function autoQuery() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (!q || !q.trim()) return;

    // 清除 URL 参数，避免刷新时重复触发
    try {
      const cleanUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, '', cleanUrl);
    } catch (_) {}

    let attempts = 0;
    const MAX = 40; // 最多等 4 秒
    function tryFire() {
      attempts++;
      // 等待 React setters 就绪（__cgBackend 由 inject-backend 注册，
      // 但 React setters 由组件挂载后才注入 —— 用 __cgMap 存在作为 ready 信号
      // 不可靠；改为直接尝试触发，失败则重试）
      const fakeInput = document.querySelector('input[placeholder*="CampusGeo"]');
      if (fakeInput && typeof window.__cgBackend === 'function') {
        // 把 query 填入输入框（视觉反馈）
        try {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(fakeInput, q.trim());
          fakeInput.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (_) {}
        // 延迟 80ms 让 React state 同步，再调用后端
        setTimeout(function () {
          // 直接构造 fakeSetters 和 callAIBackend 等价路径：
          // 找 React submit 按钮并 click，这样能正确触发所有 React state
          const submitBtn = document.querySelector('button[data-cg-submit], button.cg-submit');
          if (submitBtn) {
            submitBtn.click();
          } else {
            // fallback：直接调用 __cgBackend（需要 setters，若 React 未挂载则跳过）
            // 在 with-backend.html 中 __cgBackend 由 inject-backend.js 注册，
            // React setters 通过 build-with-backend patch 的 submit() 传入；
            // 此处用 keyboard Enter 事件模拟 submit
            fakeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          }
          console.log('[CampusGeo] Auto-query triggered:', q.trim());
        }, 80);
        return;
      }
      if (attempts < MAX) setTimeout(tryFire, 100);
      else console.warn('[CampusGeo] Auto-query timeout — could not find input or __cgBackend');
    }
    // 等 DOM 就绪后开始轮询
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() { setTimeout(tryFire, 300); });
    } else {
      setTimeout(tryFire, 300);
    }
  })();

  console.log('[CampusGeo] inject-backend ready. Test: window.testBackend("your query")');
})();
