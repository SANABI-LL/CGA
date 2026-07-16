// CampusGeo 后端注入脚本
// 将此脚本注入到 CampusGeo Print-a-Map.html 中以连接后端。
// 端点与 API key 来自 backend-config.local.js（gitignored，见
// backend-config.example.js）；缺省回退到本地 dev-server（无需 key）。

(function() {
  'use strict';

  console.log('[CampusGeo Backend] Injection script loaded');

  const cfg = window.CAMPUSGEO_CONFIG || {};
  const API_BASE = cfg.apiBase || 'http://localhost:3001';
  const API_KEY = cfg.apiKey || '';

  // 等待页面加载完成
  function waitForElement(selector, callback) {
    const element = document.querySelector(selector);
    if (element) {
      callback(element);
    } else {
      setTimeout(() => waitForElement(selector, callback), 100);
    }
  }

  // SSE 客户端
  async function queryBackend(userQuery) {
    console.log('[CampusGeo Backend] Querying:', userQuery);

    try {
      const response = await fetch(`${API_BASE}/api/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          ...(API_KEY ? { 'X-Api-Key': API_KEY } : {})
        },
        body: JSON.stringify({
          query: userQuery,
          sessionId: 'frontend-' + Date.now()
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let aiText = '';
      let geojson = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(line.slice(6));
            console.log('[CampusGeo Backend] Event:', event.type, event.toolName || '');

            switch (event.type) {
              case 'text':
                aiText += event.content;
                updateAnswerPanel(aiText);
                break;

              case 'tool_result':
                if (event.mapUpdate?.features) {
                  geojson = event.mapUpdate.features;
                  updateMap(geojson);
                }
                break;

              case 'done':
                console.log('[CampusGeo Backend] Query complete');
                return { aiText, geojson };
            }
          } catch (e) {
            console.error('[CampusGeo Backend] Parse error:', e);
          }
        }
      }

      return { aiText, geojson };

    } catch (error) {
      console.error('[CampusGeo Backend] Error:', error);
      alert(`后端连接失败: ${error.message}\n当前端点: ${API_BASE}\n（检查 backend-config.local.js 或本地 dev-server 是否就绪）`);
      return null;
    }
  }

  // 更新答案面板
  function updateAnswerPanel(text) {
    // 尝试找到答案显示区域
    let answerPanel = document.querySelector('[data-answer-panel]') ||
                      document.querySelector('.answer-text') ||
                      document.querySelector('#answer') ||
                      document.getElementById('ai-answer');

    if (!answerPanel) {
      // 创建悬浮答案面板
      answerPanel = document.createElement('div');
      answerPanel.id = 'campusgeo-answer-panel';
      answerPanel.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 400px;
        max-height: 300px;
        overflow-y: auto;
        background: rgba(255, 255, 255, 0.95);
        border: 2px solid #800000;
        border-radius: 8px;
        padding: 16px;
        font-family: 'IBM Plex Sans', sans-serif;
        font-size: 14px;
        line-height: 1.6;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
      `;

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #666;
      `;
      closeBtn.onclick = () => answerPanel.style.display = 'none';
      answerPanel.appendChild(closeBtn);

      const content = document.createElement('div');
      content.id = 'answer-content';
      content.style.marginTop = '24px';
      answerPanel.appendChild(content);

      document.body.appendChild(answerPanel);
    }

    const content = answerPanel.querySelector('#answer-content') || answerPanel;
    content.textContent = text;
    answerPanel.style.display = 'block';
  }

  // 更新地图
  function updateMap(geojson) {
    console.log('[CampusGeo Backend] Updating map with', geojson.features?.length || 0, 'features');

    // 尝试找到 ArcGIS MapView 实例
    const mapView = window.mapView || window.view || window.map?.view;

    if (!mapView) {
      console.warn('[CampusGeo Backend] MapView not found. Available globals:', Object.keys(window).filter(k => k.toLowerCase().includes('map')));
      return;
    }

    // 移除旧的图层
    if (window.__CAMPUSGEO_BACKEND_LAYER__) {
      mapView.map.remove(window.__CAMPUSGEO_BACKEND_LAYER__);
    }

    // 创建 GeoJSON Blob
    const blob = new Blob([JSON.stringify(geojson)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // 使用 ArcGIS API 加载
    if (typeof require !== 'undefined') {
      require(['esri/layers/GeoJSONLayer'], (GeoJSONLayer) => {
        window.__CAMPUSGEO_BACKEND_LAYER__ = new GeoJSONLayer({
          url: url,
          renderer: {
            type: 'simple',
            symbol: {
              type: 'simple-marker',
              color: [196, 144, 58, 0.9],  // 金色
              size: 8,
              outline: { color: [255, 255, 255, 0.8], width: 2 }
            }
          },
          popupTemplate: {
            title: function(feature) {
              // Real layer fields only (DISCRIPT1 is the buildings name column)
              const attrs = feature.graphic.attributes;
              return attrs.DISCRIPT1 || attrs.CommonName || attrs.Facility_Name || attrs.name || 'Feature';
            },
            content: function(feature) {
              const attrs = feature.graphic.attributes;
              let html = '<div style="padding: 8px; font-size: 13px;">';

              for (const [key, value] of Object.entries(attrs)) {
                if (value !== null && value !== undefined && value !== '' && key !== 'OBJECTID') {
                  html += `<div style="margin-bottom: 4px;"><strong>${key}:</strong> ${value}</div>`;
                }
              }

              html += '</div>';
              return html;
            }
          }
        });

        mapView.map.add(window.__CAMPUSGEO_BACKEND_LAYER__);

        // 缩放到图层
        window.__CAMPUSGEO_BACKEND_LAYER__.when(() => {
          if (window.__CAMPUSGEO_BACKEND_LAYER__.fullExtent) {
            mapView.goTo(window.__CAMPUSGEO_BACKEND_LAYER__.fullExtent.expand(1.2));
          }
        });

        console.log('[CampusGeo Backend] Layer added to map');
      });
    } else {
      console.error('[CampusGeo Backend] ArcGIS API require() not available');
    }
  }

  // 拦截搜索框
  function hookSearchInput() {
    // 查找搜索输入框（更宽泛的选择器）
    const searchInput = document.querySelector('input[placeholder*="CampusGeo"]') ||
                        document.querySelector('input[placeholder*="campus"]') ||
                        document.querySelector('input[type="text"]') ||
                        document.querySelector('input[placeholder*="search"]') ||
                        document.querySelector('input[placeholder*="Search"]') ||
                        document.querySelector('[role="searchbox"]') ||
                        document.querySelector('textarea[placeholder]') ||
                        document.querySelector('input:not([type="hidden"])');

    if (!searchInput) {
      console.warn('[CampusGeo Backend] Search input not found, retrying...');
      setTimeout(hookSearchInput, 500);
      return;
    }

    console.log('[CampusGeo Backend] Found search input:', searchInput);

    // 拦截回车键
    searchInput.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();

        const query = searchInput.value.trim();
        if (query) {
          console.log('[CampusGeo Backend] Intercepted query:', query);
          await queryBackend(query);
        }
      }
    });

    // 查找搜索按钮
    const searchButton = document.querySelector('button[type="submit"]') ||
                         document.querySelector('button[aria-label*="search"]') ||
                         searchInput.nextElementSibling;

    if (searchButton && searchButton.tagName === 'BUTTON') {
      console.log('[CampusGeo Backend] Found search button:', searchButton);

      searchButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const query = searchInput.value.trim();
        if (query) {
          console.log('[CampusGeo Backend] Intercepted button click:', query);
          await queryBackend(query);
        }
      });
    }
  }

  // ── 数据溯源面板真数据 ──────────────────────────────────────
  // 拉取后端 freshness 报告（S3 digest 直读，无 LLM），填充
  // window.CAMPUSGEO_LIVE —— bundle 里的 SYNC_SOURCE / SYNC_LOG / DIGEST
  // 已被 build-with-backend.mjs 补丁为渲染时优先读取该对象（取不到回退演示值）。
  async function loadFreshness() {
    try {
      const response = await fetch(`${API_BASE}/api/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { 'X-Api-Key': API_KEY } : {})
        },
        body: JSON.stringify({ freshness: true })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const d = await response.json();

      const fmt = (dt) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
      const rel = (dt) => {
        const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
        return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
      };

      const gen = d.lastRunAt ? new Date(d.lastRunAt) : null;
      const hist = (d.history && d.history.length)
        ? d.history
        : gen
        ? [{
            generatedAt: d.lastRunAt,
            status: (d.items && d.items.length) ? 'applied' : 'skipped',
            summary: (d.items && d.items.length)
              ? d.items.map((i) => i.headline).join(' · ')
              : 'No changes detected since the previous run'
          }]
        : [];

      // 下次运行：下一个 02:00 America/Chicago
      const nowCT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      const next = new Date(nowCT);
      next.setHours(2, 0, 0, 0);
      if (next <= nowCT) next.setDate(next.getDate() + 1);
      const hoursToNext = Math.max(1, Math.round((next - nowCT) / 3600000));

      window.CAMPUSGEO_LIVE = {
        syncSource: {
          name: 'UChicago Campus GIS',
          type: 'Self-hosted GeoJSON on S3',
          layers: d.layersTracked
        },
        syncLog: hist.slice(0, 5).map((h) => {
          const dt = new Date(h.generatedAt);
          return { date: fmt(dt), rel: rel(dt), summary: h.summary, status: h.status || 'applied' };
        }),
        syncLogLabel: `last ${Math.min(5, hist.length)} of ${hist.length} run${hist.length !== 1 ? 's' : ''}`,
        digestDate: d.date || undefined,
        digestItems: (d.items && d.items.length)
          ? d.items
          : gen
          ? [{
              icon: 'diff',
              headline: 'No changes in the latest sync',
              detail: `Nightly diff ran ${fmt(gen)} — no layer changes detected.`,
              sub: `${d.layersTracked} layers checked`
            }]
          : undefined,
        currentAsOf: gen ? `Campus data is current as of ${fmt(gen)}, 02:00 CT.` : undefined,
        nextRunIn: `≈ ${hoursToNext} h`
      };
      console.log('[CampusGeo Backend] Freshness loaded:', d.layersTracked, 'layers, last run', d.lastRunAt);
    } catch (err) {
      console.warn('[CampusGeo Backend] Freshness unavailable, panel keeps demo data:', err.message);
    }
  }
  loadFreshness();

  // 暴露测试函数
  window.testBackend = function(query) {
    return queryBackend(query || 'How many trees on campus?');
  };
  window.reloadFreshness = loadFreshness;

  // 初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookSearchInput);
  } else {
    hookSearchInput();
  }

  console.log('[CampusGeo Backend] ✓ Ready! Test with: window.testBackend("your query")');

})();
