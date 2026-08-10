// CampusGeo Landing — in-page query handler v4
// 쿼리 제출 시 다른 페이지로 이동하지 않고 같은 페이지 안에 결과 overlay를 표시.
// backend-config.local.js + inject-backend.js 가 <head> 에 먼저 로드되어
// window.__cgBackend 가 이미 등록된 상태에서 이 스크립트가 실행됨.

(function () {
  'use strict';

  var overlay = null;
  var mapInst = null;

  // ── Overlay 생성 ─────────────────────────────────────────────────────────
  function ensureOverlay() {
    if (overlay) return overlay;
    var el = document.createElement('div');
    el.id = '__cg-ov';
    el.style.cssText =
      'position:fixed;inset:0;z-index:9000;' +
      'background:#F5F0E8;display:flex;flex-direction:column;' +
      'font-family:Gotham,"Plus Jakarta Sans",sans-serif;' +
      'transform:translateY(100%);transition:transform 0.32s cubic-bezier(0.4,0,0.2,1);';
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:14px;padding:12px 24px;' +
        'border-bottom:1px solid #D8CFC0;background:#F5F0E8;flex-shrink:0;">' +
        '<button id="__cg-ov-back" style="font-family:inherit;font-size:13px;font-weight:500;' +
          'color:#5A5046;background:none;border:1px solid #D8CFC0;padding:6px 14px;' +
          'border-radius:6px;cursor:pointer;white-space:nowrap;">← New query</button>' +
        '<span id="__cg-ov-title" style="font-size:14px;color:#2A2218;font-weight:500;' +
          'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>' +
      '</div>' +
      '<div style="display:flex;flex:1;overflow:hidden;min-height:0;">' +
        '<div id="__cg-ov-panel" style="width:440px;min-width:300px;flex-shrink:0;' +
          'overflow-y:auto;padding:24px 28px;border-right:1px solid #D8CFC0;' +
          'font-size:14.5px;line-height:1.65;color:#2A2218;"></div>' +
        '<div id="__cg-ov-map" style="flex:1;position:relative;background:#DDD8CE;"></div>' +
      '</div>';
    document.body.appendChild(el);
    overlay = el;

    document.getElementById('__cg-ov-back').onclick = function () {
      el.style.transform = 'translateY(100%)';
      if (mapInst) { try { mapInst.remove(); } catch(e){} mapInst = null; }
    };
    return el;
  }

  function showOverlay(query) {
    var el = ensureOverlay();
    document.getElementById('__cg-ov-title').textContent = query;
    document.getElementById('__cg-ov-panel').innerHTML =
      '<div style="color:#8C8070;font-size:13px;font-family:\'IBM Plex Mono\',monospace;">' +
      'Querying campus data…</div>';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.style.transform = 'translateY(0)';
      });
    });
  }

  // ── DOM setters — inject-backend.js 의 callAIBackend 이 사용 ─────────────
  function makeDomSetters(query) {
    var panel = document.getElementById('__cg-ov-panel');
    return {
      setUnrecMsg: function (v) {
        if (typeof v === 'function') {
          panel.innerHTML = v(panel.innerHTML) || '';
        } else if (typeof v === 'string') {
          panel.innerHTML = v;
        }
      },
      setSubmitted: function () {},
      setQuery: function () {
        var inp = getInput();
        if (inp) inp.value = '';
      },
      setPhase: function () {},
      setSc: function (sc) { if (sc) renderMap(sc); },
      setTitle: function (t) {
        document.getElementById('__cg-ov-title').textContent = t || query;
      },
      setFitCmd: function () {},
    };
  }

  // ── MapLibre 지연 로드 & 렌더링 ─────────────────────────────────────────
  function loadMapLibre(cb) {
    if (window.maplibregl) { cb(); return; }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css';
    document.head.appendChild(link);
    var s = document.createElement('script');
    s.src = 'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js';
    s.onload = cb;
    document.head.appendChild(s);
  }

  function renderMap(sc) {
    loadMapLibre(function () {
      var container = document.getElementById('__cg-ov-map');
      if (!container) return;
      if (mapInst) { try { mapInst.remove(); } catch(e){} }
      mapInst = new window.maplibregl.Map({
        container: container,
        style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#E8E2D8' } }] },
        center: sc.center || [-87.5987, 41.7886],
        zoom: sc.zoom || 14,
        attributionControl: false,
      });
      window.__cgMap = mapInst;

      mapInst.on('load', function () {
        // 배경 건물
        if (sc.ctxBuildings && sc.ctxBuildings.features && sc.ctxBuildings.features.length) {
          mapInst.addSource('bldg-ctx', { type: 'geojson', data: sc.ctxBuildings });
          mapInst.addLayer({ id: 'bldg-ctx-fill', type: 'fill', source: 'bldg-ctx', paint: { 'fill-color': '#C9BCA6', 'fill-opacity': 0.45 } });
          mapInst.addLayer({ id: 'bldg-ctx-line', type: 'line', source: 'bldg-ctx', paint: { 'line-color': '#A89B86', 'line-width': 0.6 } });
        }
        // 쿼리 결과
        if (sc.data && sc.data.features && sc.data.features.length) {
          mapInst.addSource('bldg-hit', { type: 'geojson', data: sc.data });
          var firstGeom = sc.data.features[0].geometry;
          var isPoint = firstGeom && (firstGeom.type === 'Point' || firstGeom.type === 'MultiPoint');
          if (isPoint) {
            mapInst.addLayer({ id: 'results-pt', type: 'circle', source: 'bldg-hit',
              paint: { 'circle-radius': 7, 'circle-color': '#800000', 'circle-opacity': 0.85,
                       'circle-stroke-width': 1.5, 'circle-stroke-color': '#3a1a00' } });
          } else {
            mapInst.addLayer({ id: 'bldg-hit-fill', type: 'fill', source: 'bldg-hit',
              paint: { 'fill-color': ['coalesce', ['get', '_cgColor'], '#800000'], 'fill-opacity': 0.34 } });
          }
          // bounds fit
          try {
            var bnds = new window.maplibregl.LngLatBounds();
            sc.data.features.forEach(function (f) {
              if (!f.geometry) return;
              var c = f.geometry.coordinates;
              var t = f.geometry.type;
              if (t === 'Point') bnds.extend(c);
              else if (t === 'Polygon') c[0].forEach(function (p) { bnds.extend(p); });
              else if (t === 'MultiPolygon') c.forEach(function (poly) { poly[0].forEach(function (p) { bnds.extend(p); }); });
            });
            if (!bnds.isEmpty()) mapInst.fitBounds(bnds, { padding: 60, maxZoom: 17 });
          } catch (e) {}
        }
      });
    });
  }

  // ── 쿼리 실행 ────────────────────────────────────────────────────────────
  function submitQuery(q) {
    q = (q || '').trim();
    if (!q) return;
    showOverlay(q);
    var poll = 0;
    function tryCall() {
      if (typeof window.__cgBackend === 'function') {
        window.__cgBackend(q, makeDomSetters(q));
      } else if (poll++ < 30) {
        setTimeout(tryCall, 200);
      } else {
        var panel = document.getElementById('__cg-ov-panel');
        if (panel) panel.innerHTML = '<div style="color:#800000;font-size:13px;">Backend not ready. Check backend-config.local.js and refresh.</div>';
      }
    }
    tryCall();
  }

  // ── 입력 요소 탐색 ────────────────────────────────────────────────────────
  function getInput() {
    return document.querySelector('input[placeholder*="Ask CampusGeo"]') ||
           document.querySelector('input[placeholder*="CampusGeo"]') ||
           document.querySelector('input[type="text"]');
  }

  // ── document 레벨 이벤트 위임 (capture) ─────────────────────────────────
  document.addEventListener('click', function (e) {
    var btn = e.target.tagName === 'BUTTON' ? e.target :
              (e.target.closest ? e.target.closest('button') : null);
    if (!btn) return;
    // overlay 안의 버튼은 무시
    if (btn.closest('#__cg-ov')) return;

    var text = btn.textContent.trim();
    if (!text || text.length < 3) return;

    // Ask 버튼
    if (/^Ask$/i.test(text) || text.startsWith('Ask\n') || text === 'Ask ↑') {
      e.preventDefault(); e.stopPropagation();
      submitQuery(getInput() ? getInput().value : '');
      return;
    }
    // Chip 버튼 (Ask 외의 모든 버튼 → query로 처리)
    // Ask 버튼이 아니고, overlay back 버튼도 아니고, 글자가 있으면 chip
    if (text !== '← New query' && text.length > 5) {
      e.preventDefault(); e.stopPropagation();
      submitQuery(text);
    }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var inp = getInput();
    if (inp && document.activeElement === inp) {
      e.preventDefault();
      submitQuery(inp.value);
    }
  }, true);

  console.log('[CampusGeo Landing] in-page handler ready (waiting for __cgBackend)');
})();
