/**
 * patch-gotham-fonts.mjs
 *
 * Replaces all font references in CampusGeo Print-a-Map.html with Gotham.
 *
 * 关键约束：
 *   - 文件是 JSON bundle，裸双引号 (") 破坏外层 JSON 解析
 *   - 操作原始文件字符串，不做 JSON.parse/JSON.stringify 往返
 *   - 文件内换行是字面 \n 两字符序列（不是真正的 ASCII 10）
 *   - 文件内双引号是字面 \" 两字符序列
 *
 * Run: node scripts/patch-gotham-fonts.mjs
 * Then: node scripts/build-with-backend.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dir, '..');

// JSON bundle 内特殊序列（都是文件里的字面两字符序列）
const BS  = String.fromCharCode(92);    // \ (backslash char)
const DQ  = String.fromCharCode(34);    // " (double-quote char)
const NL  = BS + 'n';                   // \n  两字符：文件内换行
const EDQ = BS + DQ;                    // \"  两字符：文件内转义双引号

// ---------- 读取文件 ----------
let result = readFileSync(join(PROJECT_ROOT, 'CampusGeo Print-a-Map.html'), 'utf8');
const originalLength = result.length;

// ---------- 读取 base64 woff2 ----------
const b64 = JSON.parse(
  readFileSync(join(__dir, 'gotham-woff2', 'gotham-b64.json'), 'utf8')
);

// 健全性检查：bundle 是合法 JSON
const OPEN_TAG = '<script type="__bundler/template">';
const bStart = result.indexOf(OPEN_TAG) + OPEN_TAG.length;
const bEnd   = result.indexOf('</script>', bStart);
{
  const sample = JSON.parse(result.slice(bStart, bEnd).trim());
  console.log('Bundle sanity OK. inner length:', sample.length);
}

// ---------- 1. 移除所有 @font-face 块 ----------
// 文件内格式：@font-face {\n  ...\n}
// [^}]+ 能匹配 \n 两字符序列（因为它们不含 }）
result = result.replace(/@font-face\s*\{[^}]+\}/g, '');

// ---------- 2. 构建新 @font-face 块并注入到 <style> 之后 ----------
function face(weight, style, slug) {
  // url(\"data:font/woff2;base64,...\") — DQ 确保文件内是 \" 而不是裸双引号
  return (
    `@font-face {` + NL +
    `  font-family: 'Gotham';` + NL +
    `  font-style: ${style};` + NL +
    `  font-weight: ${weight};` + NL +
    `  font-display: swap;` + NL +
    `  src: url(${EDQ}data:font/woff2;base64,${b64[slug]}${EDQ}) format('woff2');` + NL +
    `}`
  );
}

const newFaces = [
  face(400, 'normal', 'GothamBook'),
  face(400, 'italic',  'GothamBookItalic'),
  face(500, 'normal', 'GothamMedium'),
  face(700, 'normal', 'GothamBold'),
].join(NL) + NL;

// 在 <style> 之后立刻插入
const STYLE_TAG = '<style>';
const styleIdx = result.indexOf(STYLE_TAG, bStart);
if (styleIdx === -1) throw new Error('Could not find <style> tag in bundle');

result =
  result.slice(0, styleIdx + STYLE_TAG.length) +
  NL + newFaces +
  result.slice(styleIdx + STYLE_TAG.length);

// ---------- 3. 替换 fontFamily 引用 ----------
// 文件内 fontFamily 用单引号包裹，无需额外转义

function rAll(str, from, to) { return str.split(from).join(to); }

// @font-face family names（残留或 inline style）
result = rAll(result, "font-family: 'EB Garamond'", "font-family: 'Gotham'");
result = rAll(result, "font-family: 'JetBrains Mono'", "font-family: 'Gotham'");
result = rAll(result, "font-family: 'Plus Jakarta Sans'", "font-family: 'Gotham'");

// JSX style 对象中的 fontFamily
// 原始值格式有两种：
//   a) 'JetBrains Mono,monospace'  — fallback 在引号内（对象 shorthand 风格）
//   b) 'JetBrains Mono', 'monospace' 或 'JetBrains Mono'  — 独立值
// 统一替换为 'Gotham'（不带 fallback，避免与相邻 JS 属性混淆）
result = result.replace(/fontFamily:\s*'EB Garamond[^']*'/g, "fontFamily: 'Gotham'");
result = result.replace(/fontFamily:\s*'JetBrains Mono[^']*'/g, "fontFamily: 'Gotham'");
result = result.replace(/fontFamily:\s*'Plus Jakarta Sans[^']*'/g, "fontFamily: 'Gotham'");

// SVG fontFamily 属性（原始文件里是 fontFamily=\"Plus Jakarta Sans\" — EDQ 两字符）
result = result.split('fontFamily=' + EDQ + 'Plus Jakarta Sans' + EDQ).join('fontFamily=' + EDQ + 'Gotham' + EDQ);
result = result.split('fontFamily=' + EDQ + 'EB Garamond' + EDQ).join('fontFamily=' + EDQ + 'Gotham' + EDQ);
result = result.split('fontFamily=' + EDQ + 'JetBrains Mono' + EDQ).join('fontFamily=' + EDQ + 'Gotham' + EDQ);

// IBM Plex 变体（在 bundle 内是 \"'IBM Plex Mono',monospace\" 两字符转义形式）
result = rAll(result, DQ + "'IBM Plex Mono',monospace" + DQ, "'Gotham',monospace");
result = rAll(result, DQ + "'IBM Plex Sans',sans-serif" + DQ, "'Gotham',sans-serif");

// GOTHAM 常量定义（原：const GOTHAM = "..." — 值里有 DQ，整体用双引号包裹）
result = result.replace(
  /const GOTHAM\s*=\s*["]([^"]*)["]/,
  "const GOTHAM = \"'Gotham',sans-serif\""
);

// 条件 fontFamily 表达式（三元运算式 → 直接 Gotham，不带 fallback 避免与下一属性混淆）
result = result.replace(
  /fontFamily:\s*mono\s*\?\s*'JetBrains Mono[^:]*:[^,}]*/g,
  "fontFamily: 'Gotham'"
);
result = result.replace(
  /fontFamily:\s*running\s*\?\s*'JetBrains Mono[^:]*:[^,}]*/g,
  "fontFamily: 'Gotham'"
);

// ---------- 4. 移除 Google Fonts <link> 标签 ----------
result = result.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/g, '');

// ---------- 4b. Canvas 2D ctx.font 字符串（反引号模板内，字体名用双引号） ----------
// 在原始文件里，这些双引号是 \" 两字符序列（BS + DQ）
result = result.split(EDQ + 'EB Garamond' + EDQ + ',Georgia,serif`').join(EDQ + 'Gotham' + EDQ + ',serif`');
result = result.split(EDQ + 'EB Garamond' + EDQ + ',serif`').join(EDQ + 'Gotham' + EDQ + ',serif`');
result = result.split(EDQ + 'JetBrains Mono' + EDQ + ',monospace`').join(EDQ + 'Gotham' + EDQ + ',monospace`');
result = result.split(EDQ + 'Plus Jakarta Sans' + EDQ + ',sans-serif`').join(EDQ + 'Gotham' + EDQ + ',sans-serif`');
// 也处理非转义版本（兜底）
result = result.split('"EB Garamond",Georgia,serif`').join('"Gotham",serif`');
result = result.split('"JetBrains Mono",monospace`').join('"Gotham",monospace`');
result = result.split('"Plus Jakarta Sans",sans-serif`').join('"Gotham",sans-serif`');

// ---------- 4c. CSS class 内联 font-family（单引号包裹，无逗号空格） ----------
result = result.split("font-family:'Plus Jakarta Sans',sans-serif").join("font-family:'Gotham',sans-serif");
result = result.split("font-family:'JetBrains Mono',monospace").join("font-family:'Gotham',monospace");
result = result.split("font-family:'EB Garamond',Georgia,serif").join("font-family:'Gotham',serif");

// ---------- 4d. GOTHAM 常量内的 Plus Jakarta Sans fallback ----------
result = result.split("'Gotham Book','Gotham','Plus Jakarta Sans','Helvetica Neue',sans-serif").join("'Gotham',sans-serif");

// ---------- 5. 检验 ----------
const warnFonts = ['EB Garamond', 'JetBrains Mono', 'Plus Jakarta Sans'];
for (const f of warnFonts) {
  const count = (result.match(new RegExp(f, 'g')) || []).length;
  if (count > 0) console.warn(`  ⚠ "${f}" still appears ${count}×`);
}
console.log(`  @font-face blocks: ${(result.match(/@font-face/g) || []).length}`);
console.log(`  Gotham refs: ${(result.match(/Gotham/g) || []).length}`);
console.log(`  File delta: ${result.length - originalLength} bytes`);

// 最终 bundle JSON 验证
const newBundleJson = result.slice(
  result.indexOf(OPEN_TAG) + OPEN_TAG.length,
  result.indexOf('</script>', result.indexOf(OPEN_TAG))
).trim();
try {
  const parsed = JSON.parse(newBundleJson);
  console.log('✓ Bundle JSON valid. inner length:', parsed.length);
} catch (e) {
  throw new Error('Bundle JSON INVALID after patch: ' + e.message.slice(0, 120));
}

// ---------- 6. 写入 ----------
writeFileSync(join(PROJECT_ROOT, 'CampusGeo Print-a-Map.html'), result, 'utf8');
console.log('✓ Gotham fonts patched and written.');
