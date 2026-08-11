/**
 * Replaces the idle-phase landing UI with an aino.world-style redesign.
 * Run: node scripts/patch-landing.mjs
 * Then: node scripts/build-with-backend.mjs
 *
 * 核心约束（来自 build-with-backend.mjs 注释）：
 *   TO 字符串里绝对禁止裸双引号 (ASCII 34)。
 *   文件是 JSON bundle，裸 " 直接破坏外层 JSON 解析。
 *   需要双引号时，用 BS + DQ 产生文件内 \" 两字符序列。
 *   换行用 NL = BS + 'n'（文件内 \n 两字符）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('CampusGeo Print-a-Map.html', 'utf8');

const BS = String.fromCharCode(92);   // \
const DQ = String.fromCharCode(34);   // "
const NL = BS + 'n';                  // 文件内 \n

// 字体声明（含空格，需双引号）
const plexMono = BS + DQ + "'IBM Plex Mono',monospace" + BS + DQ;
const plexSans = BS + DQ + "'IBM Plex Sans',sans-serif" + BS + DQ;

// FROM：找 idle 块起始（通用前缀，兼容已被 patch 过的 maxWidth 值）
const FROM_BASE = "phase === 'idle' ?" + NL + "        <div style={{ width: '100%', maxWidth: ";
const _fsi = html.indexOf(FROM_BASE);
if (_fsi < 0) throw new Error('idle phrase not found');
const _fend = html.indexOf("}}>", _fsi) + 3;
const FROM_START = html.slice(_fsi, _fend);

const END_MARKER = " :" + NL + "        phase === 'provenance'";

const si = html.indexOf(FROM_START);
if (si < 0) throw new Error('FROM_START not found');
const ei = html.indexOf(END_MARKER, si);
if (ei < 0) throw new Error('END_MARKER not found');

console.log('idle block: bytes', si, '-', ei);

// ─── New landing block ────────────────────────────────────────────────────────
const TO =
  "phase === 'idle' ?" + NL +
  "        <div style={{ width: '100%', maxWidth: 700, textAlign: 'center', animation: 'ccFadeUp 0.5s ease-out both' }}>" + NL +

  // Eyebrow
  "              <div style={{ fontFamily: " + plexMono + ", fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: T.inkXlt, textTransform: 'uppercase', marginBottom: 30 }}>" + NL +
  "                University of Chicago \xb7 Campus GIS" + NL +
  "              <\\u002Fdiv>" + NL +

  // Headline
  "              <h1 style={{ fontFamily: 'EB Garamond,Georgia,serif', fontWeight: 500, fontSize: 52, color: T.ink, lineHeight: 1.05, marginBottom: 16, letterSpacing: '-0.02em' }}>" + NL +
  "                Spatial intelligence<br />" + NL +
  "                <em style={{ fontStyle: 'italic', color: T.maroon }}>for the Hyde Park campus.<\\u002Fem>" + NL +
  "              <\\u002Fh1>" + NL +

  // Sub-head
  "              <p style={{ fontSize: 15.5, color: T.inkLt, lineHeight: 1.6, maxWidth: 460, margin: '0 auto 30px' }}>" + NL +
  "                Ask in plain language — CampusGeo queries the campus geodatabase, reads live data, and builds a map or print-ready sheet in seconds." + NL +
  "              <\\u002Fp>" + NL +

  // SearchBar
  "              <div style={{ marginBottom: 32 }}>" + NL +
  "                <SearchBar value={query} onChange={setQuery} onSubmit={() => submit()} big />" + NL +
  "              <\\u002Fdiv>" + NL +

  // Stats strip
  "              <div style={{ display: 'flex', borderTop: `1px solid ${T.rule}`, borderBottom: `1px solid ${T.rule}`, margin: '0 auto 36px', maxWidth: 560 }}>" + NL +
  "                {[" + NL +
  "                  { n: '308',      label: 'buildings' }," + NL +
  "                  { n: '5,491',    label: 'trees' }," + NL +
  "                  { n: '47',       label: 'GIS layers' }," + NL +
  "                  { n: '02:00 CT', label: 'daily sync' }," + NL +
  "                ].map((item, i) =>" + NL +
  "                  <div key={i} style={{ flex: 1, padding: '16px 8px', borderLeft: i > 0 ? `1px solid ${T.rule}` : 'none' }}>" + NL +
  "                    <div style={{ fontFamily: 'EB Garamond,serif', fontSize: 28, fontWeight: 600, color: T.ink, lineHeight: 1 }}>{item.n}<\\u002Fdiv>" + NL +
  "                    <div style={{ fontFamily: " + plexSans + ", fontSize: 11, color: T.inkXlt, marginTop: 5, letterSpacing: '0.03em' }}>{item.label}<\\u002Fdiv>" + NL +
  "                  <\\u002Fdiv>" + NL +
  "                )}" + NL +
  "              <\\u002Fdiv>" + NL +

  // Feature pillars
  "              <div style={{ display: 'flex', gap: 0, textAlign: 'left', marginBottom: 36, borderTop: `1px solid ${T.rule}` }}>" + NL +
  "                {[" + NL +
  "                  { n: '01', title: 'Natural language queries', desc: 'Ask about buildings, trees, utilities, or any campus layer in English or Chinese.' }," + NL +
  "                  { n: '02', title: 'Print-ready cartography',  desc: 'Generates engineering-scale maps with legend, north arrow, and scale bar.' }," + NL +
  "                  { n: '03', title: 'Verifiable data chain',    desc: 'Every result traces to a named GIS layer with a sync timestamp and provenance report.' }," + NL +
  "                ].map((item, i) =>" + NL +
  "                  <div key={item.n} style={{ flex: 1, padding: '20px 18px', borderLeft: i > 0 ? `1px solid ${T.rule}` : 'none' }}>" + NL +
  "                    <div style={{ fontFamily: " + plexMono + ", fontSize: 10, fontWeight: 700, color: T.amber, letterSpacing: '0.12em', marginBottom: 8 }}>{item.n}<\\u002Fdiv>" + NL +
  "                    <div style={{ fontFamily: 'EB Garamond,serif', fontSize: 15, fontWeight: 500, color: T.ink, marginBottom: 6, lineHeight: 1.3 }}>{item.title}<\\u002Fdiv>" + NL +
  "                    <div style={{ fontFamily: " + plexSans + ", fontSize: 12, color: T.inkMd, lineHeight: 1.55 }}>{item.desc}<\\u002Fdiv>" + NL +
  "                  <\\u002Fdiv>" + NL +
  "                )}" + NL +
  "              <\\u002Fdiv>" + NL +

  // Suggestion chips
  "              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>" + NL +
  "                {suggestions.map((s) =>" + NL +
  "                  <button key={s} onClick={() => submit(s)}" + NL +
  "                    style={{ display: 'flex', alignItems: 'center', gap: 8," + NL +
  "                      background: T.cream, border: `1px solid ${T.rule}`, borderRadius: 20, padding: '8px 14px'," + NL +
  "                      fontFamily: 'EB Garamond,serif', fontStyle: 'italic', fontSize: 14, color: T.inkMd, transition: 'all 0.12s', cursor: 'pointer' }}" + NL +
  "                    onMouseEnter={(e) => { e.currentTarget.style.background = T.paperDk; e.currentTarget.style.borderColor = T.ruleDk; }}" + NL +
  "                    onMouseLeave={(e) => { e.currentTarget.style.background = T.cream; e.currentTarget.style.borderColor = T.rule; }}>" + NL +
  "                    <Ic n='search' size={12} color={T.amber} />{s}" + NL +
  "                  <\\u002Fbutton>" + NL +
  "                )}" + NL +
  "              <\\u002Fdiv>" + NL +

  "            <\\u002Fdiv>";

// 自检：TO 不含裸双引号（未被 \ 转义的 "）
// plexMono/plexSans 用 BS+DQ 构造的 \" 是合法的；只报没有前导 \ 的 "
let bareQ = 0;
for (let i = 0; i < TO.length; i++) {
  if (TO[i] === '"' && (i === 0 || TO[i - 1] !== String.fromCharCode(92))) {
    console.error('bare DQ at TO[' + i + ']:', JSON.stringify(TO.slice(Math.max(0, i - 20), i + 25)));
    bareQ++;
  }
}
if (bareQ > 0) throw new Error('TO 含 ' + bareQ + ' 个裸双引号，停止写入');

writeFileSync('CampusGeo Print-a-Map.html', html.slice(0, si) + TO + html.slice(ei));
console.log('  ✓ landing redesigned — no bare DQ, TO bytes:', TO.length);
