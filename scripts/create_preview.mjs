import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ageFor, computeUseStats, rowFromProperties, useGroupIndex, AGE_BINS, USE_GROUPS } from './building_use.mjs';
import { computePotato, potatoPoints, classifyPlan } from './potato_plan.mjs';
import { computeUrbanForm } from './urban_form.mjs';
import { computeUrbanForm3 } from './urban_form3.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(projectDir, 'data', 'raw', 'samcheok_gis_buildings.geojson');
const reportDir = path.join(projectDir, 'reports');

function groupIndex(age) {
  if (age == null) return 11;
  if (age >= 100) return 10;
  return Math.floor(age / 10);
}

function outerRings(geometry) {
  if (!geometry) return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon) => polygon);
}

function ringCenter(ring) {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    twiceArea += cross;
    x += (ring[i][0] + ring[i + 1][0]) * cross;
    y += (ring[i][1] + ring[i + 1][1]) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    return ring.slice(0, -1).reduce((sum, p) => [sum[0] + p[0] / (ring.length - 1), sum[1] + p[1] / (ring.length - 1)], [0, 0]);
  }
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

const source = JSON.parse(await fs.readFile(dataPath, 'utf8'));
const labels = ['0–9년', '10–19년', '20–29년', '30–39년', '40–49년', '50–59년', '60–69년', '70–79년', '80–89년', '90–99년', '100년 이상', '승인일 미상'];
const colors = ['#14b8a6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7', '#7c3aed', '#4f46e5', '#2563eb', '#0f766e', '#475569', '#cbd5e1'];
const counts = Array(labels.length).fill(0);
let minLon = Infinity;
let minLat = Infinity;
let maxLon = -Infinity;
let maxLat = -Infinity;
const compact = [];
const useRows = [];

// 피처 배열: [연령대, 사용승인일, 건물명, 용도코드, 중심x, 중심y, 링, 용도대분류, 지상층수, 연면적]
for (const feature of source.features) {
  const p = feature.properties ?? {};
  const row = rowFromProperties(p, ageFor);
  useRows.push(row);
  const group = groupIndex(row.age);
  counts[group]++;
  const rings = outerRings(feature.geometry).map((ring) => ring.map((position) => {
    const lon = Number(position[0].toFixed(5));
    const lat = Number(position[1].toFixed(5));
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
    return [lon, lat];
  }));
  const center = rings.length ? ringCenter(rings[0]) : [0, 0];
  compact.push([group, String(p.useapr_day ?? ''), String(p.bld_nm ?? ''), row.code, Number(center[0].toFixed(5)), Number(center[1].toFixed(5)), rings,
    useGroupIndex(row.code), row.floors ?? 0, row.area == null ? 0 : Math.round(row.area * 10) / 10]);
}

const validCount = counts.slice(0, 11).reduce((sum, n) => sum + n, 0);
const old30 = counts.slice(3, 11).reduce((sum, n) => sum + n, 0);
const useStats = computeUseStats(useRows);
const potato = computePotato(potatoPoints(source.features));
// 철도: OpenStreetMap(Overpass) railway=rail 중 본선(측선·차량기지·건넘선 제외). © OpenStreetMap contributors, ODbL
const railPath = path.join(projectDir, 'data', 'raw', 'osm_rail', 'samcheok_rail_osm.json');
const rail = await fs.readFile(railPath, 'utf8').then((t) => {
  const pad = 0.03, inBox = ([x, y]) => x >= minLon - pad && x <= maxLon + pad && y >= minLat - pad && y <= maxLat + pad;
  return JSON.parse(t).elements
    .filter((e) => e.type === 'way' && e.tags?.railway === 'rail' && !e.tags.service && Array.isArray(e.geometry))
    .map((e) => ({ name: String(e.tags.name ?? ''), c: e.geometry.map((g) => [Number(g.lon.toFixed(5)), Number(g.lat.toFixed(5))]) }))
    .filter((w) => w.c.some(inBox));
}).catch(() => []);
potato.featureClass = source.features.map((f) => classifyPlan(f.properties));

const template = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>삼척시 건물 노후도·용도</title>
<style>
:root{--ink:#132238;--muted:#607089;--line:#e5eaf0;--surface:#fff;--bg:#eef2f6;--teal:#0f766e;--pw:min(400px,calc(100vw - 24px))}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;overflow:hidden;background:var(--bg);color:var(--ink);font-family:Inter,"Malgun Gothic","Noto Sans KR",sans-serif}
#basemapCanvas{position:fixed;inset:0;width:100vw;height:100vh;display:block;pointer-events:none;background:#eef2f6}#map{position:fixed;inset:0;width:100vw;height:100vh;display:block;cursor:grab;touch-action:none;background:transparent}#map.dragging{cursor:grabbing}
.glass{background:#ffffffeb;backdrop-filter:blur(8px);border:1px solid var(--line);border-radius:14px;box-shadow:0 6px 24px #1a2b4524}
.panel{position:fixed;left:12px;top:12px;bottom:12px;width:var(--pw);overflow:auto;padding:16px 16px 14px;z-index:2;transition:transform .25s ease}body.collapsed .panel{transform:translateX(calc(-100% - 24px))}
.toggle{position:fixed;top:12px;left:calc(var(--pw) + 20px);z-index:3;transition:left .25s ease;box-shadow:0 2px 8px #1a2b4520}body.collapsed .toggle{left:12px}
.eyebrow{font-size:11px;color:var(--teal);font-weight:800;letter-spacing:.11em;text-transform:uppercase}.panel h1{margin:5px 0 4px;font-size:21px;letter-spacing:-.04em}.sub{margin:0;color:var(--muted);font-size:12px;line-height:1.5}.badge{display:inline-block;margin-top:8px;background:#e0f2fe;color:#075985;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700}
.tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#eef2f6;padding:4px;border-radius:11px;margin-top:14px}.tabs button{border:0;background:transparent;color:var(--muted);font-size:12px;padding:8px 2px;white-space:nowrap}.tabs button[aria-selected="true"]{background:#fff;color:var(--ink);box-shadow:0 1px 3px #1a2b4526}
.controls{display:grid;grid-template-columns:auto 1fr;gap:6px 8px;align-items:center;margin:12px 0 14px}.controls label{font-size:12px;color:var(--muted)}.controls button{grid-column:1/-1}select,button{border:1px solid var(--line);border-radius:9px;background:white;color:var(--ink);font:inherit;font-size:13px;padding:7px 9px}button{cursor:pointer;font-size:12px;font-weight:700}
.metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}.metric{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px}.metric .k{color:var(--muted);font-size:11px;font-weight:650}.metric strong{display:block;font-size:19px;letter-spacing:-.04em;margin:4px 0 2px}.metric strong.txt{font-size:16px}.metric small{color:var(--muted);font-size:10.5px}
.panel h2{font-size:14px;margin:18px 0 10px;letter-spacing:-.02em}.panel h2:first-of-type{margin-top:0}.chart{display:grid;gap:7px}.barrow{display:grid;grid-template-columns:70px 1fr 46px;align-items:center;gap:8px;font-size:11px;color:#526178}.barrow.wide{grid-template-columns:92px 1fr 52px}.barrow.click{cursor:pointer;border-radius:6px;padding:2px 0}.barrow.click:hover{background:#f1f5f9}.barrow.active>span:first-child{color:var(--ink);font-weight:800}
.track{height:11px;background:#f1f5f9;border-radius:999px;overflow:hidden}.fill{height:100%;border-radius:999px}.barval{text-align:right;font-variant-numeric:tabular-nums;color:#27364b;font-weight:700}.chartnote{margin:10px 0 0;color:var(--muted);font-size:11px;line-height:1.55}
.stackrow{display:grid;grid-template-columns:92px 1fr;gap:8px;align-items:center;font-size:11px;color:#526178}.stack{display:flex;gap:2px;height:12px}.stack i{display:block;height:100%}.stack i:first-child{border-radius:4px 0 0 4px}.stack i:last-child{border-radius:0 4px 4px 0}.keys{display:flex;flex-wrap:wrap;gap:4px 10px;margin:8px 0 0 100px;font-size:10.5px;color:#526178}.keys span{display:flex;align-items:center;gap:5px}
.mini{width:100%;border-collapse:collapse;font-size:11px}.mini th,.mini td{padding:5px 4px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}.mini th:first-child,.mini td:first-child{text-align:left}.mini th{color:var(--muted);font-weight:650;font-size:10.5px}.mini td:first-child{color:#27364b}
.insights{margin:0;padding-left:17px;font-size:12px;color:#334155;line-height:1.6}.insights li{margin-bottom:4px}.insights b{color:var(--ink)}
details{margin-top:14px}summary{cursor:pointer;font-size:12px;font-weight:700;color:#27364b}details .mini{margin-top:8px}
.detail{margin-top:14px;padding:12px;background:#f8fafc;border-radius:11px;border:1px solid var(--line);min-height:80px}.detail h3{font-size:12px;margin:0 0 6px}.detail p{font-size:12px;color:#526178;margin:3px 0}.detail b{color:var(--ink)}.disclaimer{margin-top:12px;border:1px solid #f3d7a5;background:#fffaf0;color:#76551a;border-radius:11px;padding:10px 12px;font-size:11.5px;line-height:1.6}.footer{margin-top:12px;color:#718096;font-size:10.5px;line-height:1.5}.footer a{color:#2563eb;text-decoration:none}
.zoom{position:fixed;right:12px;top:12px;display:grid;gap:6px;z-index:2}.zoom button{font-size:17px;line-height:1;padding:7px 11px;box-shadow:0 2px 8px #1a2b4520}
.legend{position:fixed;right:12px;bottom:12px;z-index:2;display:flex;flex-wrap:wrap;gap:6px 12px;max-width:min(560px,calc(100vw - var(--pw) - 48px));padding:9px 12px}.legend span{display:flex;align-items:center;gap:6px;color:#526178;font-size:11px}.swatch{width:10px;height:10px;border-radius:3px;display:inline-block;flex:none}
.mapnote{position:fixed;left:calc(var(--pw) + 24px);bottom:12px;z-index:1;padding:6px 9px;font-size:11px;color:var(--muted);border-radius:8px;transition:left .25s ease}body.collapsed .mapnote{left:12px}
#tip{position:fixed;z-index:10;pointer-events:none;background:#132238;color:#fff;font-size:11px;padding:6px 8px;border-radius:7px;display:none;max-width:240px;line-height:1.45}
.eras{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.eras button,.modes button{padding:7px 4px;font-size:12px}.eras button[aria-pressed="true"],.modes button[aria-pressed="true"]{background:#132238;color:#fff;border-color:#132238}.modes{display:grid;grid-template-columns:1fr 1fr auto;gap:4px;margin-top:6px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 8px}.chips button{display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;font-size:11.5px}.chips button[aria-pressed="false"]{opacity:.45;text-decoration:line-through}.check{display:flex;gap:6px;align-items:center;font-size:12px;color:#526178;margin-bottom:14px}
#areaChart svg{width:100%;height:auto;display:block}#areaChart text{font-family:inherit}.mini.tight th,.mini.tight td{padding:5px 2px}
.rail-key{display:inline-block;width:22px;height:3px;background:repeating-linear-gradient(90deg,#3d3a5c 0 4px,#fff 4px 8px);border:1px solid #3d3a5c;border-radius:2px;flex:none}.tl{list-style:none;margin:0;padding:0;display:grid;gap:7px}.tl li{display:grid;grid-template-columns:78px 1fr;gap:8px;font-size:12px;line-height:1.5;color:#334155}.tl b{font-variant-numeric:tabular-nums}.sum3{background:#f3f4f6;border-radius:11px;padding:11px 13px;font-size:12px;line-height:1.6;color:#334155;margin-top:10px}.sum3 b{color:var(--ink)}.regbar{display:flex;height:14px;gap:2px;margin-top:4px}.regbar i{display:block;height:100%}.regbar i:first-child{border-radius:4px 0 0 4px}.regbar i:last-child{border-radius:0 4px 4px 0}
.ell-key{display:inline-block;width:18px;height:11px;border:2px dashed #9c5b3b;border-radius:50%;flex:none}.num-key{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;background:#2e2b4f;color:#fff;font-size:9px;font-weight:800;flex:none}.notes{list-style:none;margin:0;padding:0;display:grid;gap:8px}.notes li{display:grid;grid-template-columns:22px 1fr;gap:8px;font-size:12px;line-height:1.55;color:#334155;cursor:pointer;padding:6px;border-radius:9px}.notes li:hover{background:#f1f5f9}.notes b{color:var(--ink)}.notes small{color:var(--muted)}.notes .num-key{width:20px;height:20px;font-size:11px}
.axis-key{display:inline-block;width:22px;height:0;border-top:5px solid #2e2b4f;border-radius:3px;flex:none}.axis-key.sub{border-top:3px dashed #2e2b4f}.arrow-key{display:inline-block;width:22px;height:0;border-top:4px solid #b45309;position:relative;flex:none}.arrow-key:after{content:"";position:absolute;right:-2px;top:-7px;border-left:8px solid #b45309;border-top:5px solid transparent;border-bottom:5px solid transparent}.mini tr.click{cursor:pointer}.mini tr.click:hover td{background:#f1f5f9}
.center-key{display:inline-block;width:12px;height:12px;border-radius:50%;background:#f5d33f;border:2px solid #2e2b4f;flex:none}
[hidden]{display:none!important}
@media(max-width:1100px){.mapnote{display:none}}
@media(max-width:760px){.panel{left:8px;right:8px;top:auto;bottom:8px;width:auto;max-height:46vh}body.collapsed .panel{transform:translateY(calc(100% + 16px))}.toggle,body.collapsed .toggle{left:8px;top:8px}.legend{left:8px;right:56px;top:48px;bottom:auto;max-width:none;padding:7px 10px}.legend span{font-size:10px}.zoom{right:8px;top:8px}}
</style>
<link rel="preconnect" href="https://server.arcgisonline.com" crossorigin><link rel="preconnect" href="https://api.vworld.kr" crossorigin>
<script src="vworld_key.js"></script>
</head>
<body>
<script>window.__BOUNDS=__BOUNDS__;</script>
<canvas id="basemapCanvas" aria-hidden="true"></canvas>
<canvas id="map" aria-label="삼척시 건물 분포 지도"></canvas>
<aside class="panel glass" id="panel">
  <div class="eyebrow">Samcheok · Building age &amp; use</div><h1>삼척시 건물 노후도·용도</h1><p class="sub">사용승인일 기준 경과연수와 건축물대장 주용도를 지도에서 비교합니다.</p><span class="badge">분석 기준일 · 2026.11.04</span>
  <div class="tabs" role="tablist" style="grid-template-columns:repeat(4,1fr)"><button role="tab" id="tabAge" aria-selected="true" aria-controls="paneAge">노후도</button><button role="tab" id="tabUse" aria-selected="false" aria-controls="paneUse">건물 용도</button><button role="tab" id="tabPotato" aria-selected="false" aria-controls="panePotato">감자도</button><button role="tab" id="tabStruct" aria-selected="false" aria-controls="paneStruct">공간구조도</button><button role="tab" id="tabForm" aria-selected="false" aria-controls="paneForm">도시형태</button><button role="tab" id="tabForm2" aria-selected="false" aria-controls="paneForm2">도시형태2</button><button role="tab" id="tabForm3" aria-selected="false" aria-controls="paneForm3">도시형태3</button></div>
  <div class="controls"><label for="filter" id="filterLabel">연령대</label><select id="filter"></select><label for="basemap">배경</label><select id="basemap"><option value="white">회색지도</option><option value="Base">기본지도</option><option value="Satellite">영상</option><option value="none">없음</option></select><button id="resetView">전체 보기</button></div>
  <div id="paneAge" role="tabpanel">
    <section class="metrics">
      <article class="metric"><div class="k">삼척시 건물</div><strong>57,619</strong><small>행정경계 안 피처</small></article>
      <article class="metric"><div class="k">사용승인일 확인</div><strong>14,445</strong><small>전체의 25.1%</small></article>
      <article class="metric"><div class="k">30년 이상</div><strong>6,040</strong><small>유효 건물 중 41.8%</small></article>
      <article class="metric"><div class="k">중앙 연령</div><strong>27년</strong><small>유효 건물 기준</small></article>
    </section>
    <h2>승인일 확인 건물의 연령 구성</h2><div class="chart" id="chartAge"></div>
    <p class="chartnote">막대는 사용승인일이 유효한 <b>14,445건</b>을 분모로 합니다. 회색 도형은 승인일 누락·오류 또는 분석일 이후 날짜입니다.</p>
    <div class="disclaimer"><b>자료 한계</b><br>승인일 유효 건물은 전체 57,619건 중 25.1%입니다. 노후도 비율은 승인일이 확인되는 건물에 한정해 해석해야 합니다.</div>
  </div>
  <div id="paneUse" role="tabpanel" hidden>
    <section class="metrics" id="useMetrics"></section>
    <h2>핵심 결과</h2><ul class="insights" id="useInsights"></ul>
    <h2>용도 대분류별 건물 수</h2><div class="chart" id="chartUse"></div>
    <p class="chartnote">용도코드가 있는 건물을 분모로 합니다. 막대를 누르면 지도에 해당 용도만 표시합니다.</p>
    <h2>용도별 연령 구성</h2><div class="chart" id="chartUseAge"></div><div class="keys" id="ageKeys"></div>
    <p class="chartnote">용도별로 사용승인일이 유효한 건물만 100%로 나눴습니다.</p>
    <h2>용도별 요약표</h2><table class="mini" id="useTable"></table>
    <details><summary>세부 용도코드 전체 보기</summary><table class="mini" id="codeTable"></table></details>
    <div class="disclaimer" id="useDisclaimer"></div>
  </div>
  <div id="panePotato" role="tabpanel" hidden>
    <h2>시기 선택</h2>
    <div class="eras" id="eraBtns" role="group" aria-label="시기"></div>
    <div class="modes" role="group" aria-label="표시 방식"><button id="modeCum" aria-pressed="true">누적 (시기 말 기준)</button><button id="modeNew" aria-pressed="false">해당 시기 신축</button><button id="playBtn" aria-label="시기 순서대로 재생">▶ 재생</button></div>
    <div class="chips" id="layerChips" role="group" aria-label="용도 권역 표시"></div>
    <label class="check"><input type="checkbox" id="dotsToggle" checked> 건물 표시 (진한 색 = 해당 시기 건물, 회색 = 그 밖의 건물)</label>
    <section class="metrics" id="potatoMetrics"></section>
    <h2>변화 해설</h2><ul class="insights" id="potatoInsights"></ul>
    <h2>누적 감자 권역 면적 (ha)</h2><div id="areaChart"></div>
    <p class="chartnote">각 시기 말까지 사용승인된 현존 건물로 그린 권역 면적입니다. 열을 누르면 해당 시기로 이동합니다.</p>
    <h2>시기별 신축 건물 구성</h2><div class="chart" id="newChart"></div>
    <p class="chartnote">행을 누르면 해당 시기로 이동합니다.</p>
    <h2>권역 면적표 (ha)</h2><table class="mini tight" id="potatoTable"></table>
    <div class="disclaimer" id="potatoNote"></div>
  </div>
  <div id="paneStruct" role="tabpanel" hidden>
    <h2>시기 선택 (누적)</h2>
    <div class="eras" id="structEras" role="group" aria-label="공간구조도 시기"></div>
    <div class="modes" style="grid-template-columns:1fr"><button id="structPlay" aria-label="시기 순서대로 재생">▶ 시기 순서대로 재생</button></div>
    <div class="chips" id="structChips" role="group" aria-label="공간구조도 표시 요소"></div>
    <section class="metrics" id="structMetrics"></section>
    <h2>공간구조 해설</h2><ul class="insights" id="structInsights"></ul>
    <h2>중심지 위계</h2><table class="mini" id="centerTable"></table>
    <p class="chartnote">세력권은 중심지 반경 2.5km 안의 감자도 용도군 건물입니다. 행을 누르면 지도가 그 중심지로 이동합니다.</p>
    <h2>개발축</h2><table class="mini" id="axisTable"></table>
    <p class="chartnote">회랑 밀도는 축 양쪽 400m 안 건물 수를 축 길이로 나눈 값입니다.</p>
    <h2>일반화 용도 권역 면적</h2><div class="chart" id="structZoneChart"></div>
    <div class="disclaimer" id="structNote"></div>
  </div>
  <div id="paneForm" role="tabpanel" hidden>
    <h2>시기 선택 (박훈, 2020의 시기 구분)</h2>
    <div class="eras" id="formBtns" role="group" aria-label="도시형태 시기" style="grid-template-columns:repeat(3,1fr)"></div>
    <div class="chips" id="formChips" role="group" aria-label="도시형태 표시 요소"></div>
    <section class="metrics" id="formHead"></section>
    <h2>논문이 기술한 도시형태</h2><ul class="notes" id="formNotes"></ul>
    <p class="chartnote">번호는 지도의 번호와 같습니다. 항목을 누르면 지도가 그 위치로 이동합니다.</p>
    <h2>논문 Table 14와 건물 데이터 비교</h2><table class="mini" id="formCompare"></table>
    <div class="disclaimer" id="formDisc"></div>
  </div>
  <div id="paneForm2" role="tabpanel" hidden>
    <h2>3기(1982–현재) 세분 — 공간구조도 탭의 승인연도 구간</h2>
    <div class="eras" id="f2Btns" role="group" aria-label="3기 세분 구간" style="grid-template-columns:repeat(3,1fr)"></div>
    <div class="modes" style="grid-template-columns:1fr"><button id="f2Play">▶ 구간 순서대로 재생</button></div>
    <div class="chips" id="f2Chips" role="group" aria-label="도시형태2 표시 요소"></div>
    <section class="metrics" id="f2Metrics"></section>
    <h2>신축 건물 용도 구성</h2><div class="stack" id="f2Mix" style="height:16px"></div><div class="keys" id="f2Keys" style="margin-left:0"></div>
    <h2>해설</h2><ul class="insights" id="f2Insights"></ul>
    <h2>논문이 기술한 3기 변화 중 이 구간 해당</h2><ul class="notes" id="f2Notes"></ul>
    <h2>구간별 비교</h2><table class="mini tight" id="f2Table"></table>
    <div class="disclaimer" id="f2Disc"></div>
  </div>
  <div id="paneForm3" role="tabpanel" hidden>
    <h2>삼척시 도시축소 3단계 (1989년·2005년 기점)</h2>
    <div class="eras" id="f3Btns" role="group" aria-label="도시형태3 시기" style="grid-template-columns:repeat(3,1fr)"></div>
    <div class="modes" style="grid-template-columns:1fr 1fr 1fr" id="f3Views" role="group" aria-label="지도 범위"></div>
    <div class="chips" id="f3Chips" role="group" aria-label="도시형태3 표시 요소"></div>
    <section id="f3Head"></section>
    <h2>연표</h2><ul class="tl" id="f3Tl"></ul>
    <h2>지도 주석 (자료 표 · 도시형태 · 도시형태2 종합)</h2><ul class="notes" id="f3Notes"></ul>
    <h2>시기별 신축 건물 — 지역 분포</h2><div class="chart" id="f3Reg"></div><div class="keys" id="f3RegKeys" style="margin-left:0"></div>
    <h2>시기별 신축 건물 — 용도</h2><div class="chart" id="f3Mix"></div>
    <div class="disclaimer" id="f3Disc"></div>
  </div>
  <div class="detail" id="detail"><h3>건물 정보</h3><p>지도에서 건물 도형을 눌러 속성을 확인하세요.</p></div>
  <footer class="footer">출처: 국토교통부·브이월드 GIS건물통합정보 API · <a href="https://www.data.go.kr/catalog/15083092/fileData.json" target="_blank" rel="noreferrer">공식 데이터 정보</a> · 용도: 건축물대장 주용도코드 · 배경지도: 브이월드 WMTS(같은 폴더에 vworld_key.js가 있을 때), 없으면 Esri 타일(© Esri, HERE, Garmin, © OpenStreetMap contributors)</footer>
</aside>
<button class="toggle" id="togglePanel" aria-expanded="true">◀ 패널 접기</button>
<div class="zoom"><button id="zoomIn" aria-label="확대">+</button><button id="zoomOut" aria-label="축소">−</button></div>
<div class="mapnote glass" id="mapnote"></div>
<div class="legend glass" id="legend"></div>
<div id="tip" role="tooltip"></div>
<script>
// ---------- 배경지도 (데이터와 분리, 페이지 열리자마자 표시) ----------
(function(){
  const VKEY=window.VWORLD_KEY||'',bc=document.getElementById('basemapCanvas'),bx=bc.getContext('2d'),sel=document.getElementById('basemap');
  const mx=lon=>(lon+180)/360,my=lat=>{const s=Math.sin(lat*Math.PI/180);return .5-Math.log((1+s)/(1-s))/(4*Math.PI);};
  // 키가 없으면(공개 배포본) Esri 타일 사용. OSM 공식 타일은 github.io 리퍼러에 429를 반환해 쓰지 않음
  const BASEMAPS={white:{layer:'white',ext:'png',max:18,esri:'Canvas/World_Light_Gray_Base',emax:16},Base:{layer:'Base',ext:'png',max:19,esri:'World_Street_Map',emax:19},Satellite:{layer:'Satellite',ext:'jpeg',max:19,esri:'World_Imagery',emax:19}};
  if(!VKEY){const g=sel.querySelector('option[value="white"]');if(g)g.textContent='밝은 지도';const b=sel.querySelector('option[value="Base"]');if(b)b.textContent='기본 지도';const o=sel.querySelector('option[value="Satellite"]');if(o)o.textContent='위성 영상';}
  const cache=new Map();let view=null,pend=false;
  const req=()=>{if(pend)return;pend=true;requestAnimationFrame(()=>{pend=false;render();});};
  const keyOf=(bm,z,y,x)=>(VKEY?bm.layer:bm.esri)+'/'+z+'/'+y+'/'+x;
  function getTile(bm,z,x,y){const k=keyOf(bm,z,y,x);let t=cache.get(k);if(!t){t=new Image();t.decoding='async';t.onload=req;t.src=VKEY?'https://api.vworld.kr/req/wmts/1.0.0/'+VKEY+'/'+k+'.'+bm.ext:'https://server.arcgisonline.com/ArcGIS/rest/services/'+bm.esri+'/MapServer/tile/'+z+'/'+y+'/'+x;cache.set(k,t);if(cache.size>600)cache.delete(cache.keys().next().value);}return t;}
  const ready=t=>t&&t.complete&&t.naturalWidth>0;
  function render(){if(!view)return;const r=bc.getBoundingClientRect(),w=r.width,h=r.height,dpr=window.devicePixelRatio||1,W=Math.round(w*dpr),H=Math.round(h*dpr);if(bc.width!==W||bc.height!==H){bc.width=W;bc.height=H;}
    bx.setTransform(dpr,0,0,dpr,0,0);bx.clearRect(0,0,w,h);const bm=BASEMAPS[sel.value];if(!bm)return;const {cx,cy,S,panX,panY}=view;
    const z=Math.max(6,Math.min(VKEY?bm.max:bm.emax,Math.round(Math.log2(S/256)))),n=2**z,ts=S/n;
    const tx0=Math.floor((cx+(-w/2-panX)/S)*n),tx1=Math.floor((cx+(w/2-panX)/S)*n),ty0=Math.max(0,Math.floor((cy+(-h/2-panY)/S)*n)),ty1=Math.min(n-1,Math.floor((cy+(h/2-panY)/S)*n));
    // 화면 중앙에서 가까운 타일부터 요청
    const list=[];for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++)list.push([tx,ty]);const mxT=(tx0+tx1)/2,myT=(ty0+ty1)/2;list.sort((a,b)=>Math.hypot(a[0]-mxT,a[1]-myT)-Math.hypot(b[0]-mxT,b[1]-myT));
    for(const [tx,ty] of list){const xx=((tx%n)+n)%n,sx=w/2+(tx/n-cx)*S+panX,sy=h/2+(ty/n-cy)*S+panY,t=getTile(bm,z,xx,ty);
      if(ready(t)){bx.drawImage(t,sx,sy,ts+.5,ts+.5);continue;}
      for(let d=1;d<=5&&z-d>=6;d++){const p=cache.get(keyOf(bm,z-d,ty>>d,xx>>d));if(ready(p)){const f=1<<d,s2=256/f;bx.drawImage(p,(xx%f)*s2,(ty%f)*s2,s2,s2,sx,sy,ts+.5,ts+.5);break;}}}}
  window.BASE={VKEY,mx,my,setView(v){view=v;render();},render};
  sel.addEventListener('change',render);window.addEventListener('resize',render);
  // 데이터가 오기 전 초기 화면: 본체의 fitView와 같은 계산
  const b=window.__BOUNDS,B=[mx(b[0]),my(b[3]),mx(b[2]),my(b[1])],panel=document.getElementById('panel'),wd=innerWidth,ht=innerHeight;
  const o=document.body.classList.contains('collapsed')?{x:0,y:0}:wd>760?{x:panel.offsetWidth+24,y:0}:{x:0,y:panel.offsetHeight+16};
  const S0=Math.min((wd-o.x-60)/(B[2]-B[0]),(ht-o.y-60)/(B[3]-B[1]));
  window.BASE.setView({cx:(B[0]+B[2])/2,cy:(B[1]+B[3])/2,S:S0,panX:o.x/2,panY:-o.y/2});
  const note=document.getElementById('mapnote');if(note)note.textContent='건물 데이터 불러오는 중…';
})();
function __main(payload){
const features=payload.features,labels=payload.labels,colors=payload.colors,counts=payload.counts,US=payload.useStats,UG=US.groups,UNK=UG.length-1,AGE_BINS=payload.ageBins;
const BIN_COLORS=['#86b6ef','#3987e5','#1c5cab','#0d366b'];
const useNames=Object.fromEntries(US.codes.map(c=>[c.code,c.name]));
const fmt=n=>Math.round(n).toLocaleString('ko-KR'),pct=(a,b)=>b?(a/b*100).toFixed(1)+'%':'–',esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const canvas=document.getElementById('map'),ctx=canvas.getContext('2d');
const filter=document.getElementById('filter'),filterLabel=document.getElementById('filterLabel'),legend=document.getElementById('legend');
let tab='age';
try{if(localStorage.getItem('samcheokTab')==='use')tab='use';}catch(e){}
try{const t=localStorage.getItem('samcheokTab');if(t==='potato')tab='potato';if(t==='struct')tab='struct';if(t==='form')tab='form';if(t==='form2')tab='form2';if(t==='form3')tab='form3';}catch(e){}
if(location.hash==='#use')tab='use';else if(location.hash==='#age')tab='age';else if(location.hash==='#potato')tab='potato';else if(location.hash==='#struct')tab='struct';else if(location.hash==='#form')tab='form';else if(location.hash==='#form2')tab='form2';else if(location.hash==='#form3')tab='form3';

// ---------- 노후도 탭 차트 ----------
const maxCount=Math.max(...counts.slice(0,11));
const chartAge=document.getElementById('chartAge');
for(let i=0;i<11;i++){const row=document.createElement('div');row.className='barrow';row.dataset.tip=labels[i]+': '+fmt(counts[i])+'건 ('+pct(counts[i],payload.validCount)+')';row.innerHTML='<span>'+labels[i]+'</span><div class="track"><div class="fill" style="width:'+Math.max(0.6,counts[i]/maxCount*100)+'%;background:'+colors[i]+'"></div></div><span class="barval">'+fmt(counts[i])+'</span>';chartAge.append(row);}

// ---------- 건물 용도 탭 ----------
const known=UG.slice(0,UNK).map((g,i)=>({...g,i}));
function renderUse(){
  const byLabel=l=>known.find(g=>g.label===l);
  const housing=(byLabel('단독주택')?.count||0)+(byLabel('공동주택')?.count||0);
  const ranked=known.filter(g=>g.dated>=100);
  const oldest=ranked.reduce((a,g)=>g.old30/g.dated>a.old30/a.dated?g:a,ranked[0]);
  const youngest=ranked.reduce((a,g)=>g.old30/g.dated<a.old30/a.dated?g:a,ranked[0]);
  const areaTotal=known.reduce((s,g)=>s+g.areaSum,0);
  const biggestArea=known.reduce((a,g)=>g.areaSum>a.areaSum?g:a,known[0]);
  const topNonRes=known.filter(g=>g.label!=='단독주택'&&g.label!=='공동주택').sort((a,b)=>b.count-a.count)[0];
  const det=byLabel('단독주택'),apt=byLabel('공동주택'),old40=known.reduce((s,g)=>s+g.bins[3],0);
  document.getElementById('useMetrics').innerHTML=
    '<article class="metric"><div class="k">용도코드 확인</div><strong>'+fmt(US.known)+'</strong><small>전체의 '+pct(US.known,US.total)+'</small></article>'+
    '<article class="metric"><div class="k">주거용(단독·공동)</div><strong>'+pct(housing,US.known)+'</strong><small>용도 확인 건물 대비</small></article>'+
    '<article class="metric"><div class="k">30년 이상 비율 최고</div><strong class="txt">'+esc(oldest.label)+'</strong><small>승인일 유효 '+fmt(oldest.dated)+'건 중 '+pct(oldest.old30,oldest.dated)+'</small></article>'+
    '<article class="metric"><div class="k">연면적 합계 최대</div><strong class="txt">'+esc(biggestArea.label)+'</strong><small>'+fmt(biggestArea.areaSum)+'㎡ · '+pct(biggestArea.areaSum,areaTotal)+'</small></article>';
  const ins=[
    '용도가 확인된 '+fmt(US.known)+'건 중 <b>단독주택이 '+pct(det.count,US.known)+'</b>('+fmt(det.count)+'건)로 압도적입니다. 중위 연면적 '+fmt(det.medianArea)+'㎡, 평균 지상 '+det.meanFloors.toFixed(1)+'층의 소형 저층 주택이 중심입니다.',
    '주거 다음으로 많은 용도는 <b>'+esc(topNonRes.label)+'</b>('+pct(topNonRes.count,US.known)+')입니다.',
    '<b>'+esc(apt.label)+'</b>는 건물 수로는 '+pct(apt.count,US.known)+'이지만 연면적 합계는 '+pct(apt.areaSum,areaTotal)+'를 차지합니다(평균 '+apt.meanFloors.toFixed(1)+'층).',
    '30년 이상 비율은 <b>'+esc(oldest.label)+' '+pct(oldest.old30,oldest.dated)+'</b>로 가장 높고, '+esc(youngest.label)+'이 '+pct(youngest.old30,youngest.dated)+'로 가장 낮습니다.',
    '용도가 확인된 40년 이상 건물 '+fmt(old40)+'건 중 <b>단독주택이 '+pct(det.bins[3],old40)+'</b>('+fmt(det.bins[3])+'건)입니다.'
  ];
  document.getElementById('useInsights').innerHTML=ins.map(s=>'<li>'+s+'</li>').join('');
  const chart=document.getElementById('chartUse'),max=Math.max(...known.map(g=>g.count));chart.innerHTML='';
  for(const g of [...known].sort((a,b)=>b.count-a.count)){const row=document.createElement('div');row.className='barrow wide click';row.dataset.group=g.i;row.tabIndex=0;row.setAttribute('role','button');
    row.dataset.tip=g.label+': '+fmt(g.count)+'건 · 용도 확인 대비 '+pct(g.count,US.known)+' · 연면적 '+fmt(g.areaSum)+'㎡';
    row.innerHTML='<span>'+esc(g.label)+'</span><div class="track"><div class="fill" style="width:'+Math.max(0.8,g.count/max*100)+'%;background:'+g.color+'"></div></div><span class="barval">'+fmt(g.count)+'</span>';
    const pick=()=>{filter.value=filter.value===String(g.i)?'all':String(g.i);syncActive();draw();};row.addEventListener('click',pick);row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});chart.append(row);}
  const sa=document.getElementById('chartUseAge');sa.innerHTML='';
  for(const g of [...known].filter(g=>g.dated>0).sort((a,b)=>b.old30/b.dated-a.old30/a.dated)){const row=document.createElement('div');row.className='stackrow';
    row.innerHTML='<span>'+esc(g.label)+'</span><div class="stack">'+g.bins.map((c,k)=>c?'<i style="width:'+(c/g.dated*100)+'%;background:'+BIN_COLORS[k]+'" data-tip="'+esc(g.label)+' · '+AGE_BINS[k]+': '+fmt(c)+'건 ('+pct(c,g.dated)+')"></i>':'').join('')+'</div>';sa.append(row);}
  document.getElementById('ageKeys').innerHTML=AGE_BINS.map((l,k)=>'<span><i class="swatch" style="background:'+BIN_COLORS[k]+'"></i>'+l+'</span>').join('');
  document.getElementById('useTable').innerHTML='<thead><tr><th>용도</th><th>건수</th><th>중앙 연령</th><th>30년+</th><th>연면적(천㎡)</th></tr></thead><tbody>'+
    known.map(g=>'<tr><td><i class="swatch" style="background:'+g.color+';margin-right:5px"></i>'+esc(g.label)+'</td><td>'+fmt(g.count)+'</td><td>'+(g.medianAge==null?'–':Math.round(g.medianAge)+'년')+'</td><td>'+pct(g.old30,g.dated)+'</td><td>'+(g.areaSum/1000).toFixed(1)+'</td></tr>').join('')+'</tbody>';
  document.getElementById('codeTable').innerHTML='<thead><tr><th>코드 · 용도</th><th>건수</th><th>중앙 연령</th><th>30년+</th></tr></thead><tbody>'+
    US.codes.map(c=>'<tr><td>'+c.code+' '+esc(c.name)+'</td><td>'+fmt(c.count)+'</td><td>'+(c.medianAge==null?'–':Math.round(c.medianAge)+'년')+'</td><td>'+pct(c.old30,c.dated)+'</td></tr>').join('')+'</tbody>';
  const unk=UG[UNK];
  document.getElementById('useDisclaimer').innerHTML='<b>자료 한계</b><br>용도 미상 '+fmt(unk.count)+'건('+pct(unk.count,US.total)+')은 건축물대장 속성이 거의 비어 있어 비율의 분모에서 뺐습니다. 미상 건물의 실제 용도 구성은 다를 수 있습니다. 기타에는 분뇨·쓰레기·자원순환·묘지·장례·관광휴게·야영장시설과 명칭을 확인하지 못한 구(Z) 코드를 묶었습니다. 용도는 주용도 하나만 반영합니다.';
}
renderUse();
function syncActive(){for(const r of document.querySelectorAll('#chartUse .barrow'))r.classList.toggle('active',r.dataset.group===filter.value);}

// ---------- 탭 전환 ----------
function buildFilter(){const prev=filter.value;filter.innerHTML='';const add=(v,t)=>{const o=document.createElement('option');o.value=v;o.textContent=t;filter.append(o);};add('all','전체');
  if(tab==='age'){filterLabel.textContent='연령대';labels.forEach((l,i)=>add(String(i),l));}else{filterLabel.textContent='용도';add('known','용도 확인 건물만');UG.forEach((g,i)=>add(String(i),g.label));}
  if([...filter.options].some(o=>o.value===prev)&&prev==='all')filter.value=prev;}
function buildLegend(){legend.innerHTML='';if(tab==='form3'&&!F3)return;if(tab==='form3'){const add=h=>{const e=document.createElement('span');e.innerHTML=h;legend.append(e);};const pc=F3.meta[f3i].color;add('<i class="swatch" style="background:#cfaea6"></i>주거지역(누적)');add('<i class="swatch" style="background:#7d82a6"></i>산업지역(누적)');add('<i class="swatch" style="background:transparent;border:2px solid '+pc+'"></i>해당 시기 신규 시가지');add('<i class="swatch" style="background:'+pc+'"></i>해당 시기 건물');add('<i class="swatch" style="background:#5b5870"></i>이전 시기 건물');if(f3L.old30)add('<i class="swatch" style="background:'+OLD_C+'"></i>사용승인 30년 이상');add('<i class="ell-key" style="border-color:#1f5f86;border-style:solid"></i>중심(핵)');add('<i class="ell-key" style="border-color:#c2410c"></i>축소');add('<i class="ell-key" style="border-color:#15803d;border-style:solid"></i>성장·집중');add('<i class="axis-key" style="border-top-color:'+pc+'"></i>연결·이동');if(RAIL.length)add('<i class="rail-key"></i>철도');return;}if(tab==='form2'){const add=h=>{const e=document.createElement('span');e.innerHTML=h;legend.append(e);};for(const c of PC)add('<i class="swatch" style="background:'+c.color+'"></i>'+c.label);add('<i class="swatch" style="background:#ece4dd;border:1px solid #cfaea6"></i>누적 주거지역');add('<i class="swatch" style="background:#d6d7e4;border:1px solid #7d82a6"></i>누적 산업지역');add('<i class="swatch" style="background:#5b5870"></i>이전 구간 건물');add('<i class="swatch" style="background:#c9c9d3"></i>이후·미상 건물');add('<i class="arrow-key"></i>신축 무게중심 이동');add('<i class="num-key" style="background:#4b7bb5">1</i>논문 주석');return;}if(tab==='form'){const add=h=>{const e=document.createElement('span');e.innerHTML=h;legend.append(e);};const pc=FM.meta[fPer].color;if(fLayers.old30)add('<i class="swatch" style="background:'+OLD_C+'"></i>사용승인 30년 이상 건축물');add('<i class="swatch" style="background:#cfaea6"></i>주거지역(누적)');add('<i class="swatch" style="background:#7d82a6"></i>산업지역(누적)');add('<i class="swatch" style="background:transparent;border:2px solid '+pc+'"></i>해당 시기 신규 시가지');add('<i class="ell-key" style="border-color:'+pc+'"></i>논문 기술 범위(개략)');add('<i class="axis-key" style="border-top-color:'+pc+'"></i>발전축·이동');add('<i class="num-key" style="background:'+pc+'">1</i>논문 주석');add('<i class="swatch" style="background:'+pc+'"></i>해당 시기 건물');add('<i class="swatch" style="background:#5b5870"></i>이전 시기 건물');add('<i class="swatch" style="background:#c9c9d3"></i>이후·미상 건물');return;}if(tab==='struct'){const add=h=>{const e=document.createElement('span');e.innerHTML=h;legend.append(e);};for(const c of PC)add('<i class="swatch" style="background:'+c.color+'"></i>'+c.label);add('<i class="center-key"></i>중심지(원 크기 = 위계)');if(RAIL.length)add('<i class="rail-key"></i>철도');add('<i class="axis-key"></i>주 개발축');add('<i class="axis-key sub"></i>부 개발축');add('<i class="arrow-key"></i>시가지 확산 방향');return;}if(tab==='potato'){for(const c of PC){const e=document.createElement('span');e.innerHTML='<i class="swatch" style="background:'+c.color+'"></i>'+c.label+' 권역';legend.append(e);}const e=document.createElement('span');e.innerHTML='<i class="center-key"></i>중심지(상업·공공기관 밀도 정점)';legend.append(e);return;}const items=tab==='age'?labels.map((l,i)=>[l,colors[i],i===11&&counts[i]===0]):UG.map(g=>[g.label,g.color,false]);
  for(const [l,c,skip] of items){if(skip)continue;const e=document.createElement('span');e.innerHTML='<i class="swatch" style="background:'+c+'"></i>'+esc(l);legend.append(e);}}
function setTab(t){tab=t;try{localStorage.setItem('samcheokTab',t);}catch(e){}
  document.getElementById('tabAge').setAttribute('aria-selected',String(t==='age'));document.getElementById('tabUse').setAttribute('aria-selected',String(t==='use'));
  document.getElementById('tabPotato').setAttribute('aria-selected',String(t==='potato'));document.getElementById('tabStruct').setAttribute('aria-selected',String(t==='struct'));document.getElementById('paneStruct').hidden=t!=='struct';document.getElementById('tabForm').setAttribute('aria-selected',String(t==='form'));document.getElementById('paneForm').hidden=t!=='form';document.getElementById('tabForm2').setAttribute('aria-selected',String(t==='form2'));document.getElementById('paneForm2').hidden=t!=='form2';document.getElementById('tabForm3').setAttribute('aria-selected',String(t==='form3'));document.getElementById('paneForm3').hidden=t!=='form3';if(t!=='form2')stopF2Play();document.getElementById('paneAge').hidden=t!=='age';document.getElementById('paneUse').hidden=t!=='use';document.getElementById('panePotato').hidden=t!=='potato';filter.hidden=filterLabel.hidden=t==='potato'||t==='struct'||t==='form'||t==='form2'||t==='form3';if(t!=='potato')stopPlay();if(t!=='struct')stopStructPlay();
  canvas.setAttribute('aria-label',t==='age'?'삼척시 건물 연령대 분포 지도':t==='use'?'삼척시 건물 용도 분포 지도':t==='potato'?'삼척시 용도 권역 감자도':t==='struct'?'삼척시 공간구조도':t==='form'?'삼척시 시기별 도시형태 지도':t==='form2'?'삼척시 3기 세분 도시형태 지도':'삼척시 도시축소 3단계 지도');buildFilter();buildLegend();syncActive();draw();}
document.getElementById('tabAge').addEventListener('click',()=>setTab('age'));document.getElementById('tabUse').addEventListener('click',()=>setTab('use'));document.getElementById('tabPotato').addEventListener('click',()=>setTab('potato'));document.getElementById('tabStruct').addEventListener('click',()=>setTab('struct'));document.getElementById('tabForm3').addEventListener('click',()=>{const first=tab!=='form3';setTab('form3');if(first)f3View('all');});document.getElementById('tabForm2').addEventListener('click',()=>{const first=tab!=='form2';setTab('form2');if(first)fitForm();});document.getElementById('tabForm').addEventListener('click',()=>{const first=tab!=='form';setTab('form');if(first)fitForm();});

// ---------- 툴팁 ----------
const tip=document.getElementById('tip');
document.getElementById('panel').addEventListener('mousemove',e=>{const t=e.target.closest('[data-tip]');if(!t){tip.style.display='none';return;}tip.textContent=t.dataset.tip;tip.style.display='block';const x=Math.min(e.clientX+12,innerWidth-tip.offsetWidth-8);tip.style.left=x+'px';tip.style.top=(e.clientY+14)+'px';});
document.getElementById('panel').addEventListener('mouseleave',()=>{tip.style.display='none';});

// ---------- 지도 ----------
// 웹 메르카토르(0~1 월드 좌표)로 미리 변환해 브이월드 WMTS 타일과 좌표계를 맞춘다. 경계상자는 f[10].
const VKEY=BASE.VKEY,basemapSel=document.getElementById('basemap'),mx=BASE.mx,my=BASE.my;
for(const f of features){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const ring of f[6])for(const p of ring){p[0]=mx(p[0]);p[1]=my(p[1]);if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];if(p[1]<y0)y0=p[1];if(p[1]>y1)y1=p[1];}f[4]=mx(f[4]);f[5]=my(f[5]);f[10]=[x0,y0,x1,y1];}
const b=payload.bounds,B=[mx(b[0]),my(b[3]),mx(b[2]),my(b[1])],cx=(B[0]+B[2])/2,cy=(B[1]+B[3])/2;let zoom=1,panX=0,panY=0,baseScale=1,drag=null,lastPointer=null;
const panelEl=document.getElementById('panel'),toggleBtn=document.getElementById('togglePanel');
function panelOffset(){if(document.body.classList.contains('collapsed'))return {x:0,y:0};return innerWidth>760?{x:panelEl.offsetWidth+24,y:0}:{x:0,y:panelEl.offsetHeight+16};}
function resize(){const r=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);const o=panelOffset();baseScale=Math.min((r.width-o.x-60)/(B[2]-B[0]),(r.height-o.y-60)/(B[3]-B[1]));draw();}
function fitView(){const o=panelOffset();zoom=1;panX=o.x/2;panY=-o.y/2;resize();}
toggleBtn.addEventListener('click',()=>{const c=document.body.classList.toggle('collapsed');toggleBtn.textContent=c?'▶ 패널 열기':'◀ 패널 접기';toggleBtn.setAttribute('aria-expanded',String(!c));});
function project(x,y,w,h){const S=baseScale*zoom;return [w/2+(x-cx)*S+panX,h/2+(y-cy)*S+panY];}
const BASE_ATTR=VKEY?'배경 © VWorld':'배경 © Esri, HERE, Garmin, © OpenStreetMap contributors';
let drawPending=false;
function requestDraw(){if(drawPending)return;drawPending=true;requestAnimationFrame(()=>{drawPending=false;draw();});}
function visible(f){if(tab==='form3')return !!(f3L&&f3L.bld);if(tab==='form2')return f2L.bld;if(tab==='form')return fLayers.bld;if(tab==='struct')return sLayers.bld&&f[11]>=0;if(tab==='potato')return inScene(f);const v=filter.value;if(v==='all')return true;if(v==='known')return f[7]!==UNK;return Number(v)===(tab==='age'?f[0]:f[7]);}
function styleOf(f){return tab==='age'?[colors[f[0]],f[0]===11?.72:.85]:[UG[f[7]].color,f[7]===UNK?.4:.88];}
function draw(){const r=canvas.getBoundingClientRect(),w=r.width,h=r.height,S=baseScale*zoom;ctx.clearRect(0,0,w,h);BASE.setView({cx,cy,S,panX,panY});
const vx0=cx+(-w/2-panX)/S,vx1=cx+(w/2-panX)/S,vy0=cy+(-h/2-panY)/S,vy1=cy+(h/2-panY)/S,ox=w/2-cx*S+panX,oy=h/2-cy*S+panY,outline=zoom>=6;
if(tab==='form3'){drawForm3(w,h,S,ox,oy,vx0,vx1,vy0,vy1);return;}
if(tab==='form2'){drawForm2(w,h,S,ox,oy,vx0,vx1,vy0,vy1);return;}
if(tab==='form'){drawForm(w,h,S,ox,oy,vx0,vx1,vy0,vy1);return;}
if(tab==='struct'){drawStruct(w,h,S,ox,oy,vx0,vx1,vy0,vy1);return;}
if(tab==='potato'){drawPotato(w,h,S,ox,oy,vx0,vx1,vy0,vy1);return;}
let shown=0;if(outline){ctx.strokeStyle='rgba(15,23,42,.45)';ctx.lineWidth=.7;}
for(const f of features){if(!visible(f))continue;shown++;const e=f[10];if(e[2]<vx0||e[0]>vx1||e[3]<vy0||e[1]>vy1)continue;ctx.beginPath();for(const ring of f[6]){if(!ring.length)continue;ctx.moveTo(ox+ring[0][0]*S,oy+ring[0][1]*S);for(let j=1;j<ring.length;j++)ctx.lineTo(ox+ring[j][0]*S,oy+ring[j][1]*S);ctx.closePath();}const st=styleOf(f);ctx.fillStyle=st[0];ctx.globalAlpha=st[1];ctx.fill('evenodd');if(outline){ctx.globalAlpha=1;ctx.stroke();}}
ctx.globalAlpha=1;document.getElementById('mapnote').textContent=fmt(shown)+'개 건물 도형 표시 · 휠 확대 / 드래그 이동 · '+BASE_ATTR;}
function zoomAt(factor,x,y){const old=zoom;zoom=Math.max(1,Math.min(256,zoom*factor));const ratio=zoom/old,r=canvas.getBoundingClientRect(),w=r.width,h=r.height;panX=x-w/2-(x-w/2-panX)*ratio;panY=y-h/2-(y-h/2-panY)*ratio;draw();}
function findFeature(x,y){const r=canvas.getBoundingClientRect();let closest=null,dist=13;for(const f of features){if(!visible(f))continue;const p=project(f[4],f[5],r.width,r.height),d=Math.hypot(p[0]-x,p[1]-y);if(d<dist){dist=d;closest=f;}}return closest;}
function showDetail(f){const age=f[0]===11?'승인일 미상':labels[f[0]],use=f[3]?(useNames[f[3]]||f[3])+' ('+f[3]+')':'용도 미상';
  document.getElementById('detail').innerHTML='<h3>선택한 건물</h3><p>건물명: <b>'+esc(f[2]||'미기재')+'</b></p><p>용도: <b>'+esc(use)+'</b> · '+esc(UG[f[7]].label)+'</p><p>사용승인일: <b>'+esc(f[1]||'미상')+'</b> · 경과연수 <b>'+age+'</b></p><p>지상층수: <b>'+(f[8]?f[8]+'층':'미상')+'</b> · 연면적: <b>'+(f[9]?f[9].toLocaleString('ko-KR')+'㎡':'미상')+'</b></p>';}
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,moved:false};lastPointer={x:e.clientX,y:e.clientY};canvas.classList.add('dragging');});
canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-lastPointer.x,dy=e.clientY-lastPointer.y;if(Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)>4)drag.moved=true;panX+=dx;panY+=dy;lastPointer={x:e.clientX,y:e.clientY};draw();});
canvas.addEventListener('pointerup',e=>{canvas.classList.remove('dragging');if(drag&&!drag.moved){const r=canvas.getBoundingClientRect(),f=findFeature(e.clientX-r.left,e.clientY-r.top);if(f)showDetail(f);}drag=null;});
canvas.addEventListener('wheel',e=>{e.preventDefault();const r=canvas.getBoundingClientRect();zoomAt(e.deltaY<0?1.2:1/1.2,e.clientX-r.left,e.clientY-r.top);},{passive:false});
filter.addEventListener('change',()=>{syncActive();draw();});basemapSel.addEventListener('change',draw);document.getElementById('resetView').addEventListener('click',fitView);document.getElementById('zoomIn').addEventListener('click',()=>zoomAt(1.3,canvas.clientWidth/2,canvas.clientHeight/2));document.getElementById('zoomOut').addEventListener('click',()=>zoomAt(1/1.3,canvas.clientWidth/2,canvas.clientHeight/2));window.addEventListener('resize',resize);
// ---------- 감자도 ----------
const PT=payload.potato,PC=PT.classes,ERAS=PT.eras,FC=PT.featureClass;
for(const k in PT.scenes)for(const sc of PT.scenes[k]){sc.m=sc.rings.map(r=>r.map(q=>[mx(q[0]),my(q[1])]));for(const l of sc.labels)l.m=[mx(l.at[0]),my(l.at[1])];}
for(const k in PT.centers)for(const c of PT.centers[k])c.m=[mx(c.at[0]),my(c.at[1])];
features.forEach((f,i)=>{f[11]=FC[i];f[12]=f[0]!==11?Number(f[1].slice(0,4)):null;});
let era=ERAS.length-1,pMode='cum',layers=PC.map(()=>true),showDots=true,playTimer=null;
const eraOf=y=>ERAS.findIndex(e=>y>=e.start&&y<=e.end);
const newCounts=ERAS.map(()=>PC.map(()=>0));for(const f of features)if(f[11]>=0&&f[12]!=null){const e=eraOf(f[12]);if(e>=0)newCounts[e][f[11]]++;}
const sceneKey=()=>era==='all'?'all':pMode+':'+ERAS[era].key,scene=()=>PT.scenes[sceneKey()];
const sceneName=()=>era==='all'?'현재 전체(승인일 미상 포함)':ERAS[era].label+(pMode==='cum'?' 누적':' 신축');
function inScene(f){const c=f[11];if(c<0||!layers[c])return false;if(era==='all')return true;const y=f[12];if(y==null)return false;const e=ERAS[era];return pMode==='cum'?y<=e.end:y>=e.start&&y<=e.end;}
function centersNow(){return era==='all'?PT.centers.all:pMode==='cum'?PT.centers['cum:'+ERAS[era].key]:[];}
// 건물 실제 도형: 확대(1.6배 이상) 시 화면 안 모든 건물 도형을 그림. 장면 건물은 진하게, 나머지는 옅은 회색 맥락.
// 축소 화면에서는 도형이 1px보다 작아 보이지 않으므로 장면 건물만 점으로 표시.
function footprintPath(f,ox,oy,S){ctx.beginPath();for(const ring of f[6]){if(!ring.length)continue;ctx.moveTo(ox+ring[0][0]*S,oy+ring[0][1]*S);for(let j=1;j<ring.length;j++)ctx.lineTo(ox+ring[j][0]*S,oy+ring[j][1]*S);ctx.closePath();}}
function drawFootprints(isScene,ox,oy,S,vx0,vx1,vy0,vy1){
  if(zoom<1.6){ctx.fillStyle='#3d3a5c';ctx.globalAlpha=.65;const d=1.6;for(const f of features){if(!isScene(f))continue;if(f[4]<vx0||f[4]>vx1||f[5]<vy0||f[5]>vy1)continue;ctx.fillRect(ox+f[4]*S-d/2,oy+f[5]*S-d/2,d,d);}ctx.globalAlpha=1;return;}
  const minPx=1.2;
  for(const pass of [0,1]){ctx.fillStyle=pass?'#34314f':'#9a9aae';ctx.globalAlpha=pass?.85:.45;
    for(const f of features){const e=f[10];if(e[2]<vx0||e[0]>vx1||e[3]<vy0||e[1]>vy1)continue;if((isScene(f)?1:0)!==pass)continue;
      if((e[2]-e[0])*S<minPx&&(e[3]-e[1])*S<minPx){ctx.fillRect(ox+f[4]*S-minPx/2,oy+f[5]*S-minPx/2,minPx,minPx);continue;}
      footprintPath(f,ox,oy,S);ctx.fill('evenodd');}}
  ctx.globalAlpha=1;}
function drawPotato(w,h,S,ox,oy,vx0,vx1,vy0,vy1){
  let shown=0;const sz=Math.min(6,1.6+zoom*.2);if(basemapSel.value!=='none'){ctx.fillStyle='rgba(247,242,235,.45)';ctx.fillRect(0,0,w,h);}
  if(showDots)drawFootprints(inScene,ox,oy,S,vx0,vx1,vy0,vy1);
  for(const f of features)if(inScene(f))shown++;
  const sc=scene();ctx.lineJoin='round';
  PC.forEach((c,ci)=>{if(!layers[ci])return;for(const r of sc[ci].m){ctx.beginPath();ctx.moveTo(ox+r[0][0]*S,oy+r[0][1]*S);for(let j=1;j<r.length;j++)ctx.lineTo(ox+r[j][0]*S,oy+r[j][1]*S);ctx.closePath();ctx.globalAlpha=.5;ctx.fillStyle=c.color;ctx.fill();}});ctx.globalAlpha=1;
  ctx.font='700 12px Inter,"Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';const minHa=Math.max(8,60/zoom);
  PC.forEach((c,ci)=>{if(!layers[ci])return;for(const l of sc[ci].labels){if(l.ha<minHa)continue;const x=ox+l.m[0]*S,y=oy+l.m[1]*S;ctx.lineWidth=3;ctx.strokeStyle='rgba(255,255,255,.75)';ctx.strokeText(c.label,x,y);ctx.fillStyle='#2e2b4f';ctx.fillText(c.label,x,y);}});
  centersNow().slice(0,5).forEach((c,i)=>{const x=ox+c.m[0]*S,y=oy+c.m[1]*S;ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fillStyle='#f5d33f';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#2e2b4f';ctx.stroke();ctx.fillStyle='#132238';ctx.font='800 10px Inter,sans-serif';ctx.fillText(String(i+1),x,y+.5);});
  ctx.globalAlpha=1;document.getElementById('mapnote').textContent=sceneName()+' · 건물 '+fmt(shown)+'건 · 휠 확대 / 드래그 이동 · '+BASE_ATTR;}
const eraBtns=document.getElementById('eraBtns');
[...ERAS.map((e,i)=>[i,e.label]),['all','현재 전체']].forEach(([v,l])=>{const b=document.createElement('button');b.textContent=l;b.dataset.era=v;b.addEventListener('click',()=>{stopPlay();setEra(v==='all'?'all':Number(v));});eraBtns.append(b);});
const chips=document.getElementById('layerChips');
PC.forEach((c,ci)=>{const b=document.createElement('button');b.setAttribute('aria-pressed','true');b.innerHTML='<i class="swatch" style="background:'+c.color+'"></i>'+c.label;b.addEventListener('click',()=>{layers[ci]=!layers[ci];b.setAttribute('aria-pressed',String(layers[ci]));renderPotato();draw();});chips.append(b);});
document.getElementById('dotsToggle').addEventListener('change',e=>{showDots=e.target.checked;draw();});
function setMode(m){pMode=m;document.getElementById('modeCum').setAttribute('aria-pressed',String(m==='cum'));document.getElementById('modeNew').setAttribute('aria-pressed',String(m==='new'));renderPotato();draw();}
document.getElementById('modeCum').addEventListener('click',()=>setMode('cum'));document.getElementById('modeNew').addEventListener('click',()=>setMode('new'));
function setEra(v){era=v;renderPotato();draw();}
function stopPlay(){if(playTimer){clearInterval(playTimer);playTimer=null;document.getElementById('playBtn').textContent='▶ 재생';}}
document.getElementById('playBtn').addEventListener('click',()=>{if(playTimer){stopPlay();return;}let i=era==='all'||era===ERAS.length-1?0:era+1;setEra(i);document.getElementById('playBtn').textContent='■ 정지';playTimer=setInterval(()=>{i++;if(i>=ERAS.length){stopPlay();return;}setEra(i);},1600);});
const areaOf=(k,ci)=>PT.scenes[k][ci].areaHa;
function renderAreaChart(){
  const W=360,H=200,L=40,R=58,T=10,Bm=26,iw=W-L-R,ih=H-T-Bm,act=PC.map((c,ci)=>ci).filter(ci=>layers[ci]);
  const vals=ERAS.map(e=>PC.map((c,ci)=>areaOf('cum:'+e.key,ci)));const max=Math.max(100,...ERAS.flatMap((e,ei)=>act.map(ci=>vals[ei][ci])));
  const step=Math.pow(10,Math.floor(Math.log10(max/4))),nice=Math.ceil(max/4/step)*step,top=nice*4;
  const X=i=>L+iw*i/(ERAS.length-1),Y=v=>T+ih*(1-v/top);
  let g='';for(let k=0;k<=4;k++){const y=Y(nice*k);g+='<line x1="'+L+'" x2="'+(L+iw)+'" y1="'+y+'" y2="'+y+'" stroke="#e5eaf0"/><text x="'+(L-6)+'" y="'+y+'" font-size="10" fill="#607089" text-anchor="end" dominant-baseline="middle">'+fmt(nice*k)+'</text>';}
  if(era!=='all')g+='<rect x="'+(X(era)-13)+'" y="'+T+'" width="26" height="'+ih+'" fill="#132238" opacity=".07" rx="4"/>';
  ERAS.forEach((e,i)=>{g+='<text x="'+X(i)+'" y="'+(H-8)+'" font-size="10" fill="'+(i===era?'#132238':'#607089')+'" font-weight="'+(i===era?700:400)+'" text-anchor="middle">'+e.label.replace('년대','s')+'</text>';});
  for(const ci of act){const c=PC[ci];g+='<polyline fill="none" stroke="'+c.color+'" stroke-width="2" stroke-linejoin="round" points="'+ERAS.map((e,i)=>X(i)+','+Y(vals[i][ci])).join(' ')+'"/>';
    ERAS.forEach((e,i)=>{g+='<circle cx="'+X(i)+'" cy="'+Y(vals[i][ci])+'" r="'+(i===era?4.5:3)+'" fill="'+c.color+'" stroke="#fff" stroke-width="1.5"/>';});}
  const ends=act.map(ci=>({ci,y:Y(vals[ERAS.length-1][ci])})).sort((a,b)=>a.y-b.y);for(let k=1;k<ends.length;k++)if(ends[k].y-ends[k-1].y<14)ends[k].y=ends[k-1].y+14;
  for(const e of ends)g+='<text x="'+(L+iw+8)+'" y="'+e.y+'" font-size="10.5" fill="#27364b" dominant-baseline="middle">'+PC[e.ci].label+'</text>';
  ERAS.forEach((e,i)=>{const tip=e.label+' 누적 · '+act.map(ci=>PC[ci].label+' '+fmt(vals[i][ci])+'ha').join(' · ');g+='<rect class="hit" data-era="'+i+'" data-tip="'+tip+'" x="'+(X(i)-iw/(ERAS.length-1)/2)+'" y="'+T+'" width="'+(iw/(ERAS.length-1))+'" height="'+(ih+Bm)+'" fill="transparent" style="cursor:pointer"/>';});
  const el=document.getElementById('areaChart');el.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="시기별 누적 감자 권역 면적 선그래프">'+g+'</svg>';
  for(const r of el.querySelectorAll('.hit'))r.addEventListener('click',()=>{stopPlay();pMode='cum';setMode('cum');setEra(Number(r.dataset.era));});}
function renderNewChart(){const el=document.getElementById('newChart');el.innerHTML='';const tot=newCounts.map(r=>r.reduce((s,v,ci)=>s+(layers[ci]?v:0),0)),max=Math.max(...tot);
  ERAS.forEach((e,i)=>{const row=document.createElement('div');row.className='barrow wide click'+(i===era?' active':'');row.tabIndex=0;row.setAttribute('role','button');
    row.innerHTML='<span>'+e.label+'</span><div class="stack" style="width:'+(tot[i]/max*100)+'%">'+PC.map((c,ci)=>layers[ci]&&newCounts[i][ci]?'<i style="width:'+(newCounts[i][ci]/tot[i]*100)+'%;background:'+c.color+'" data-tip="'+e.label+' 신축 · '+c.label+' '+fmt(newCounts[i][ci])+'건 ('+pct(newCounts[i][ci],tot[i])+')"></i>':'').join('')+'</div><span class="barval">'+fmt(tot[i])+'</span>';
    const go=()=>{stopPlay();setEra(i);};row.addEventListener('click',go);row.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();go();}});el.append(row);});}
function renderPotato(){
  for(const b of eraBtns.children)b.setAttribute('aria-pressed',String(String(era)===b.dataset.era));
  document.querySelector('.modes').style.opacity=era==='all'?.45:1;
  const sc=scene(),act=PC.map((c,ci)=>ci).filter(ci=>layers[ci]);
  const n=act.reduce((s,ci)=>s+sc[ci].n,0),ha=act.reduce((s,ci)=>s+sc[ci].areaHa,0),cnt=act.reduce((s,ci)=>s+sc[ci].rings.length,0);
  const best=(arr,fn)=>arr.reduce((a,b)=>fn(b)>fn(a)?b:a,arr[0]);
  let m3k='',m3v='',m3s='',ins=[];
  if(!act.length){ins=['표시할 용도 권역을 하나 이상 켜세요.'];}
  else if(era==='all'){const b=best(act,ci=>sc[ci].areaHa);m3k='가장 넓은 권역';m3v=PC[b].label;m3s=fmt(sc[b].areaHa)+'ha';
    ins=['승인일과 관계없이 감자도 용도군에 속하는 건물 '+fmt(n)+'건으로 그린 현재 용도 구조입니다.','승인일 미상 건물이 포함되어 2020~ 누적보다 권역이 넓게 나타납니다.','가장 넓은 권역은 <b>'+PC[b].label+' '+fmt(sc[b].areaHa)+'ha</b>('+sc[b].rings.length+'곳)입니다.'];}
  else if(pMode==='cum'){const e=ERAS[era],prev=era>0?PT.scenes['cum:'+ERAS[era-1].key]:null;
    ins.push('<b>'+e.label+'</b>까지 사용승인된 현존 건물 '+fmt(n)+'건으로 용도 권역 '+cnt+'곳, 총 '+fmt(ha)+'ha가 형성됩니다.');
    if(prev){const d=best(act,ci=>sc[ci].areaHa-prev[ci].areaHa),dv=sc[d].areaHa-prev[d].areaHa;m3k='최대 확장 권역';m3v=PC[d].label;m3s='직전 대비 +'+fmt(dv)+'ha';
      if(dv>0)ins.push('직전 시기 대비 <b>'+PC[d].label+' 권역이 +'+fmt(dv)+'ha</b>로 가장 크게 넓어졌습니다.');
      const born=act.filter(ci=>prev[ci].areaHa===0&&sc[ci].areaHa>0).map(ci=>PC[ci].label);if(born.length)ins.push('<b>'+born.join('·')+'</b> 권역이 이 시기에 처음 나타납니다.');
      const more=act.filter(ci=>sc[ci].rings.length>prev[ci].rings.length).map(ci=>PC[ci].label+' '+prev[ci].rings.length+'→'+sc[ci].rings.length+'곳');if(more.length)ins.push('권역 수가 늘어난 용도: '+more.join(', ')+'.');}
    else{const b=best(act,ci=>sc[ci].areaHa);m3k='가장 넓은 권역';m3v=PC[b].label;m3s=fmt(sc[b].areaHa)+'ha';ins.push('이 시기에는 임계 밀도를 넘는 권역이 '+cnt+'곳뿐입니다.');}
    const cs=centersNow();if(cs.length)ins.push('상업·공공기관 밀도 정점(지도의 번호 원)은 '+cs.slice(0,5).length+'곳입니다.');}
  else{const e=ERAS[era],cnts=newCounts[era],tot=act.reduce((s,ci)=>s+cnts[ci],0),b=best(act,ci=>cnts[ci]),a=best(act,ci=>sc[ci].areaHa);m3k='최다 신축 용도';m3v=PC[b].label;m3s=pct(cnts[b],tot);
    ins.push('<b>'+e.label+'</b>에 사용승인된 현존 건물 '+fmt(tot)+'건 중 <b>'+PC[b].label+'이 '+pct(cnts[b],tot)+'</b>로 가장 많습니다.');
    if(sc[a].areaHa>0)ins.push('신축이 모인 권역이 가장 넓은 용도는 <b>'+PC[a].label+'</b>('+sc[a].rings.length+'곳, '+fmt(sc[a].areaHa)+'ha)입니다.');else ins.push('이 시기 신축은 흩어져 있어 임계 밀도를 넘는 권역이 없습니다.');
    ins.push('신축 장면은 건물 수가 적어 임계 밀도를 누적 장면의 '+Math.round(PT.method.newScale*100)+'%로 낮춰 그렸습니다.');}
  document.getElementById('potatoMetrics').innerHTML='<article class="metric"><div class="k">표시 건물</div><strong>'+fmt(n)+'</strong><small>'+esc(sceneName())+'</small></article><article class="metric"><div class="k">감자 권역</div><strong>'+fmt(ha)+'ha</strong><small>'+cnt+'곳</small></article>'+(m3k?'<article class="metric" style="grid-column:1/-1"><div class="k">'+m3k+'</div><strong class="txt">'+esc(m3v)+'</strong><small>'+m3s+'</small></article>':'');
  document.getElementById('potatoInsights').innerHTML=ins.map(t=>'<li>'+t+'</li>').join('');
  renderAreaChart();renderNewChart();
  document.getElementById('potatoTable').innerHTML='<thead><tr><th>권역</th>'+ERAS.map(e=>'<th>'+e.label.replace('년대','s').replace('~1979','~79')+'</th>').join('')+'<th>전체</th></tr></thead><tbody>'+PC.map((c,ci)=>'<tr><td><i class="swatch" style="background:'+c.color+';margin-right:4px"></i>'+c.label+'</td>'+ERAS.map(e=>'<td>'+fmt(areaOf('cum:'+e.key,ci))+'</td>').join('')+'<td>'+fmt(areaOf('all',ci))+'</td></tr>').join('')+'</tbody>';
}
document.getElementById('potatoNote').innerHTML='<b>방법</b><br>용도군별 건물 위치로 가우시안 커널 밀도(σ='+PT.method.sigmaM+'m, '+PT.method.cellM+'m 격자)를 구하고, 시기와 관계없이 고정한 임계 밀도('+PC.map(c=>c.label+' '+c.threshold).join(', ')+' 건/ha) 이상 지역을 매끄럽게 다듬어 권역으로 그렸습니다. 여러 용도가 기준을 넘는 칸은 밀도÷임계값^'+PT.method.dominanceExp+' 점수가 가장 큰 용도 하나에만 배정해 권역이 겹치지 않습니다. 다세대·연립과 아파트는 지상층수로, 공공기관은 건물명으로 구분했습니다(이름 없는 관공서는 상업 등으로 남음). '+PT.method.minAreaHa+'ha 미만 권역은 생략했습니다. 용도군 정의: '+PC.map(c=>'<b>'+c.label+'</b> '+esc(c.desc)).join(' · ')+'. 문화·종교·의료·노유자·수련·운동·방송통신·환경시설은 감자도에서 제외했습니다.<br><br><b>자료 한계</b><br>현재 남아 있는 건물의 사용승인일로 과거를 재구성했기 때문에, 멸실·재건축된 건물은 빠집니다. 따라서 과거 시기일수록 실제 시가지보다 작게 나타납니다. 용도는 현재 주용도 기준이며, 승인일과 용도가 모두 있는 건물만 시기 장면에 쓰입니다.';
renderPotato();
// ---------- 공간구조도 ----------
const ST=PT.structure,LEVELS=['도심','지역중심','부도심','생활권중심'],LR=[17,12,11,7];
for(const k in ST.scenes){const sc=ST.scenes[k];for(const z of sc.zones){z.m=z.rings.map(r=>r.map(q=>[mx(q[0]),my(q[1])]));for(const l of z.labels)l.m=[mx(l.at[0]),my(l.at[1])];}sc.centers.forEach(c=>{c.m=[mx(c.at[0]),my(c.at[1])];});sc.arrows.forEach(a=>{a.fm=[mx(a.from[0]),my(a.from[1])];a.tm=[mx(a.to[0]),my(a.to[1])];});}
const RAIL=(payload.rail||[]).map(w=>({name:w.name,m:w.c.map(q=>[mx(q[0]),my(q[1])])}));
let sEra='all',sPlay=null;const SS=()=>ST.scenes[sEra==='all'?'all':'cum:'+ERAS[sEra].key];
const sEraName=()=>sEra==='all'?'현재 전체(승인일 미상 포함)':ERAS[sEra].label+'까지 누적';
const sLayers={zones:true,rail:true,axes:true,arrows:true,centers:true,bld:true};
const SL=[['zones','용도 권역'],['rail','철도'],['axes','개발축'],['arrows','확산 방향'],['centers','중심지'],['bld','건물']];
const sChips=document.getElementById('structChips');
for(const [k,l] of SL){const b=document.createElement('button');b.textContent=l;b.setAttribute('aria-pressed',String(sLayers[k]));b.addEventListener('click',()=>{sLayers[k]=!sLayers[k];b.setAttribute('aria-pressed',String(sLayers[k]));draw();});sChips.append(b);}
function drawStruct(w,h,S,ox,oy,vx0,vx1,vy0,vy1){
  const P2=m=>[ox+m[0]*S,oy+m[1]*S];
  if(basemapSel.value!=='none'){ctx.fillStyle='rgba(247,242,235,.55)';ctx.fillRect(0,0,w,h);}
  let shown=0;
  const inStruct=f=>{if(f[11]<0)return false;if(sEra==='all')return true;return f[12]!=null&&f[12]<=ERAS[sEra].end;};
  if(sLayers.bld){for(const f of features)if(inStruct(f))shown++;drawFootprints(inStruct,ox,oy,S,vx0,vx1,vy0,vy1);}
  if(sLayers.zones){const zs=SS().zones,order=zs.map((z,ci)=>ci).sort((x,y)=>zs[y].areaHa-zs[x].areaHa);order.forEach(ci=>{const z=zs[ci];for(const r of z.m){ctx.beginPath();let p=P2(r[0]);ctx.moveTo(p[0],p[1]);for(let j=1;j<r.length;j++){p=P2(r[j]);ctx.lineTo(p[0],p[1]);}ctx.closePath();ctx.globalAlpha=.5;ctx.fillStyle=PC[ci].color;ctx.fill();}});ctx.globalAlpha=1;
    ctx.font='600 11px Inter,"Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';const minHa=Math.max(15,300/zoom);
    SS().zones.forEach((z,ci)=>{for(const l of z.labels){if(l.ha<minHa)continue;const p=P2(l.m);ctx.lineWidth=3;ctx.strokeStyle='rgba(255,255,255,.7)';ctx.strokeText(PC[ci].label,p[0],p[1]);ctx.fillStyle='#4a4560';ctx.fillText(PC[ci].label,p[0],p[1]);}});}
  if(sLayers.rail&&RAIL.length){ctx.lineCap='butt';ctx.lineJoin='round';const pass=(wd,col,dash)=>{ctx.setLineDash(dash);ctx.lineWidth=wd;ctx.strokeStyle=col;for(const r of RAIL){ctx.beginPath();let p=P2(r.m[0]);ctx.moveTo(p[0],p[1]);for(let j=1;j<r.m.length;j++){p=P2(r.m[j]);ctx.lineTo(p[0],p[1]);}ctx.stroke();}};pass(2.2,'#3d3a5c',[]);pass(1,'#ffffff',[4,4]);ctx.setLineDash([]);}
  ctx.lineCap='round';
  if(sLayers.axes)for(const a of SS().axes){const A=P2(SS().centers[a.a].m),B=P2(SS().centers[a.b].m);ctx.beginPath();ctx.moveTo(A[0],A[1]);ctx.lineTo(B[0],B[1]);ctx.setLineDash(a.level?[10,8]:[]);ctx.lineWidth=a.level?3.5:7;ctx.strokeStyle='#2e2b4f';ctx.globalAlpha=a.level?.7:.78;ctx.stroke();}
  ctx.setLineDash([]);ctx.globalAlpha=1;
  if(sLayers.arrows)for(const a of SS().arrows){const A=P2(a.fm),B=P2(a.tm),ang=Math.atan2(B[1]-A[1],B[0]-A[0]),L=Math.hypot(B[0]-A[0],B[1]-A[1]);if(L<14)continue;const hl=Math.min(16,L*.45),E=[B[0]-Math.cos(ang)*hl*.8,B[1]-Math.sin(ang)*hl*.8];
    ctx.beginPath();ctx.moveTo(A[0],A[1]);ctx.lineTo(E[0],E[1]);ctx.lineWidth=5;ctx.strokeStyle='#b45309';ctx.stroke();
    ctx.beginPath();ctx.moveTo(B[0],B[1]);ctx.lineTo(B[0]-Math.cos(ang-.45)*hl,B[1]-Math.sin(ang-.45)*hl);ctx.lineTo(B[0]-Math.cos(ang+.45)*hl,B[1]-Math.sin(ang+.45)*hl);ctx.closePath();ctx.fillStyle='#b45309';ctx.fill();}
  if(sLayers.centers){ctx.textAlign='center';ctx.textBaseline='top';
    for(const c of [...SS().centers].sort((a,b)=>b.level-a.level)){const p=P2(c.m),r=LR[c.level];
      if(c.level===0){ctx.beginPath();ctx.arc(p[0],p[1],r+6,0,Math.PI*2);ctx.lineWidth=2;ctx.strokeStyle='#2e2b4f';ctx.globalAlpha=.6;ctx.stroke();ctx.globalAlpha=1;}
      ctx.beginPath();ctx.arc(p[0],p[1],r,0,Math.PI*2);ctx.fillStyle='#f5d33f';ctx.fill();ctx.lineWidth=2.5;ctx.strokeStyle='#2e2b4f';ctx.stroke();
      const big=c.level<=1;ctx.font=(big?'800 13px':'700 11px')+' Inter,"Malgun Gothic",sans-serif';const ty=p[1]+r+(c.level===0?9:4),txt=c.name;
      ctx.lineWidth=3.5;ctx.strokeStyle='rgba(255,255,255,.9)';ctx.strokeText(txt,p[0],ty);ctx.fillStyle='#2e2b4f';ctx.fillText(txt,p[0],ty);
      ctx.font='600 10px Inter,"Malgun Gothic",sans-serif';ctx.strokeText(LEVELS[c.level],p[0],ty+(big?16:14));ctx.fillStyle='#607089';ctx.fillText(LEVELS[c.level],p[0],ty+(big?16:14));}}
  document.getElementById('mapnote').textContent='공간구조도 · '+sEraName()+(sLayers.bld?' · 건물 '+fmt(shown)+'건':'')+' · 휠 확대 / 드래그 이동 · '+BASE_ATTR+(RAIL.length?' · 철도 © OpenStreetMap':'');}
function goTo(m,z){const r=canvas.getBoundingClientRect(),o=panelOffset();zoom=z;const S=baseScale*zoom;panX=(r.width+o.x)/2-r.width/2-(m[0]-cx)*S;panY=(r.height-o.y)/2-r.height/2-(m[1]-cy)*S;draw();}
function renderStruct(){
  for(const b of document.getElementById('structEras').children)b.setAttribute('aria-pressed',String(String(sEra)===b.dataset.era));
  const C=SS().centers;
  if(C.length<2){document.getElementById('structMetrics').innerHTML='<article class="metric" style="grid-column:1/-1"><div class="k">'+esc(sEraName())+'</div><strong class="txt">'+(C[0]?esc(C[0].name)+' 단일 중심':'중심지 없음')+'</strong><small>감자도 용도군 건물 '+fmt(SS().n)+'건</small></article>';document.getElementById('structInsights').innerHTML='<li>이 시기에는 세력권 건물 150건 이상인 중심지가 '+C.length+'곳뿐이라 개발축이 없습니다. 시가지가 '+(C[0]?esc(C[0].name):'한 곳')+'에 모여 있습니다.</li>';document.getElementById('centerTable').innerHTML='';document.getElementById('axisTable').innerHTML='';renderZoneChart();return;}
  const top=C[0],second=C[1],byLv=l=>C.filter(c=>c.level===l),main=SS().axes.filter(a=>a.level===0),sub=SS().axes.filter(a=>a.level===1);
  const axName=a=>esc(C[a.a].name)+'–'+esc(C[a.b].name);
  document.getElementById('structMetrics').innerHTML='<article class="metric"><div class="k">도심</div><strong class="txt">'+esc(top.name)+'</strong><small>세력권 건물 '+fmt(top.n)+'건</small></article>'+
    '<article class="metric"><div class="k">중심지 위계</div><strong>'+C.length+'곳</strong><small>지역중심 '+byLv(1).length+' · 부도심 '+byLv(2).length+' · 생활권 '+byLv(3).length+'</small></article>'+
    '<article class="metric"><div class="k">개발축</div><strong>'+SS().axes.length+'개</strong><small>주축 '+main.length+' · 부축 '+sub.length+'</small></article>'+
    '<article class="metric"><div class="k">도심 집중도</div><strong>'+(top.n/second.n).toFixed(1)+'배</strong><small>2위 '+esc(second.name)+' 대비</small></article>';
  const ins=[];
  ins.push('<b>'+esc(sEraName())+'</b> 기준, <b>'+esc(top.name)+'</b>의 세력권(2.5km) 건물은 '+fmt(top.n)+'건으로 2위 '+esc(second.name)+'의 '+(top.n/second.n).toFixed(1)+'배입니다. 하나의 도심이 압도적인 <b>단핵 구조</b>입니다.');
  if(byLv(1).length)ins.push('지역중심은 '+byLv(1).map(c=>'<b>'+esc(c.name)+'</b>('+fmt(c.n)+'건)').join(', ')+'입니다. 도심 세력권의 20% 이상이면서 도심에서 5km 넘게 떨어진 중심지를 지역중심으로 보았습니다.');
  if(byLv(3).length)ins.push('생활권중심 '+byLv(3).length+'곳: '+byLv(3).map(c=>esc(c.name)).join(', ')+'.');
  const dens=[...main].sort((a,b)=>b.density-a.density)[0];
  if(main.length)ins.push('주 개발축은 '+main.map(a=>'<b>'+axName(a)+'</b>').join(', ')+'입니다. 가장 조밀한 축은 '+axName(dens)+'(회랑 '+fmt(dens.density)+'건/km)입니다.');
  const splitTxt=sEra==='all'?'1989년 이전 건물 대비 2000년 이후 건물':ERAS[sEra-1]?ERAS[sEra-1].label.replace('~','')+'까지 건물 대비 '+ERAS[sEra].label+' 신축':'';
  for(const a of SS().arrows)ins.push(esc(a.center)+': '+splitTxt+'의 무게중심이 <b>'+a.dir+'쪽으로 '+fmt(a.shiftM)+'m</b> 이동했습니다.');
  const nonDet=SS().zones.map((z,ci)=>({ci,ha:z.areaHa})).filter(z=>PC[z.ci].key!=='det').sort((a,b)=>b.ha-a.ha)[0];
  if(nonDet)ins.push(PC[0].label+'를 제외하고 가장 넓은 일반화 권역은 <b>'+PC[nonDet.ci].label+'</b>('+fmt(nonDet.ha)+'ha)입니다.');
  document.getElementById('structInsights').innerHTML=ins.map(t=>'<li>'+t+'</li>').join('');
  const ct=document.getElementById('centerTable');
  ct.innerHTML='<thead><tr><th>위계</th><th>중심지</th><th>세력권 건물</th><th>저밀주거 외 주기능</th></tr></thead><tbody>'+C.map((c,i)=>'<tr class="click" data-i="'+i+'" tabindex="0"><td>'+LEVELS[c.level]+'</td><td>'+esc(c.name)+'</td><td>'+fmt(c.n)+'</td><td><i class="swatch" style="background:'+PC[c.feature].color+';margin-right:4px"></i>'+PC[c.feature].label+' '+pct(c.mix[c.feature],c.n)+'</td></tr>').join('')+'</tbody>';
  for(const tr of ct.querySelectorAll('tr.click')){const go=()=>goTo(C[+tr.dataset.i].m,10);tr.addEventListener('click',go);tr.addEventListener('keydown',e=>{if(e.key==='Enter'){go();}});}
  document.getElementById('axisTable').innerHTML='<thead><tr><th>축</th><th>구분</th><th>길이</th><th>회랑 밀도</th></tr></thead><tbody>'+[...SS().axes].sort((a,b)=>a.level-b.level||b.density-a.density).map(a=>'<tr><td>'+axName(a)+'</td><td>'+(a.level?'부축':'주축')+'</td><td>'+a.km+'km</td><td>'+fmt(a.density)+'건/km</td></tr>').join('')+'</tbody>';
  renderZoneChart();
}
function renderZoneChart(){
  const zc=document.getElementById('structZoneChart'),zmax=Math.max(...SS().zones.map(z=>z.areaHa));zc.innerHTML='';
  SS().zones.map((z,ci)=>({ci,ha:z.areaHa,n:z.rings.length})).sort((a,b)=>b.ha-a.ha).forEach(z=>{const row=document.createElement('div');row.className='barrow wide';row.dataset.tip=PC[z.ci].label+' 권역 '+z.n+'곳 · '+fmt(z.ha)+'ha';row.innerHTML='<span>'+PC[z.ci].label+'</span><div class="track"><div class="fill" style="width:'+Math.max(.8,z.ha/zmax*100)+'%;background:'+PC[z.ci].color+'"></div></div><span class="barval">'+fmt(z.ha)+'</span>';zc.append(row);});
}
function renderStructNote(){
  document.getElementById('structNote').innerHTML='<b>방법</b><br>감자도와 같은 용도군·색을 쓰되, 좁은 커널(σ=150m)과 약한 다듬기로 실제 시가지 윤곽을 따라가는 아메바형 권역을 그렸습니다. 용도마다 따로 권역을 그려 서로 겹칠 수 있고(반투명), 넓은 권역을 먼저·좁은 권역을 나중에 그립니다. 시기 버튼은 해당 시기 말까지 사용승인된 현존 건물만으로 중심지·축·권역을 다시 계산합니다. 중심지·축 계산에는 넓은 커널(σ='+ST.method.sigmaM+'m)을 씁니다. 중심지는 상업·공공기관 밀도의 국지 정점(1.5km 간격)입니다. 위계는 세력권('+(ST.method.catchM/1000)+'km) 건물 수로 정했습니다: 1위 도심, 도심의 20% 이상이면 지역중심(도심에서 5km 초과)·부도심(5km 이내), 나머지는 생활권중심입니다. 중심지 이름은 가장 가까운 읍·면·동 사무소나 주변 시설명에서 따왔습니다. 개발축은 중심지를 잇는 최소신장트리이고, 회랑 밀도 상위 40%를 주축으로 보았습니다. 확산 방향은 세력권(3km) 안에서 직전 시기까지의 건물과 해당 시기 신축 건물의 무게중심 차이입니다(현재 전체는 1989년 이전 대비 2000년 이후). 철도는 OpenStreetMap의 운행 철도 본선입니다(© OpenStreetMap contributors, ODbL).<br><br><b>자료 한계</b><br>개발축은 도로망이 아니라 중심지 사이 직선 연결입니다. 실제 도로·지형(산지, 하천)은 반영하지 않았습니다. 현존 건물 기준이라 멸실된 과거 시가지는 빠집니다.';
}
const sEraBtns=document.getElementById('structEras');
[...ERAS.map((e,i)=>[i,e.label]),['all','현재 전체']].forEach(([v,l])=>{const b=document.createElement('button');b.textContent=l;b.dataset.era=v;b.addEventListener('click',()=>{stopStructPlay();setStructEra(v==='all'?'all':Number(v));});sEraBtns.append(b);});
function setStructEra(v){sEra=v;renderStruct();draw();}
function stopStructPlay(){if(sPlay){clearInterval(sPlay);sPlay=null;document.getElementById('structPlay').textContent='▶ 시기 순서대로 재생';}}
document.getElementById('structPlay').addEventListener('click',()=>{if(sPlay){stopStructPlay();return;}let i=0;setStructEra(0);document.getElementById('structPlay').textContent='■ 정지';sPlay=setInterval(()=>{i++;if(i>=ERAS.length){stopStructPlay();setStructEra('all');return;}setStructEra(i);},1800);});
renderStruct();renderStructNote();
// ---------- 도시형태 (박훈 2020) ----------
const FM=payload.form,FK=FM.meta.map(m=>m.key);let fPer=2;
const fLayers={area:true,notes:true,bld:true,old30:true};const OLD_C='#b8577a';
const old30N=features.reduce((n,f)=>n+(f[0]>=3&&f[0]<=10?1:0),0);
const LL=q=>[mx(q[0]),my(q[1])];
for(const k of FK){const p=FM.periods[k];for(const n of ['housing','industry','newArea','gyodongArea'])if(p[n])p[n+'M']=p[n].map(r=>r.map(LL));}
for(const k of FK)FM.notes[k].forEach((n,i)=>{n.no=i+1;if(n.at)n.m=LL(n.at);if(n.from){n.fm=LL(n.from);n.tm=LL(n.to);}if(n.path)n.pm=n.path.map(LL);});
const fChips=document.getElementById('formChips');
for(const [k,l] of [['old30','30년 이상 건축물'],['area','시가지 윤곽'],['notes','논문 주석'],['bld','건물']]){const b=document.createElement('button');b.textContent=l;b.setAttribute('aria-pressed','true');b.addEventListener('click',()=>{fLayers[k]=!fLayers[k];b.setAttribute('aria-pressed',String(fLayers[k]));buildLegend();draw();});fChips.append(b);}
const fBtns=document.getElementById('formBtns');
FM.meta.forEach((m,i)=>{const b=document.createElement('button');b.innerHTML=m.label+'<br><small style="font-weight:500">'+m.range+'</small>';b.dataset.i=i;b.addEventListener('click',()=>{fPer=i;renderForm();buildLegend();draw();});fBtns.append(b);});
function fitForm(){const bb=FM.bbox,r=canvas.getBoundingClientRect(),o=panelOffset(),x0=mx(bb[0]),x1=mx(bb[2]),y0=my(bb[3]),y1=my(bb[1]);const z=Math.min((r.width-o.x-80)/((x1-x0)*baseScale),(r.height-o.y-80)/((y1-y0)*baseScale));goTo([(x0+x1)/2,(y0+y1)/2],Math.max(1,Math.min(256,z)));}
const mPerWorld=lat=>40075016.7*Math.cos(lat*Math.PI/180);
function fRings(rs,S,ox,oy,fill,alpha,stroke,lw,dash){for(const r of rs){ctx.beginPath();ctx.moveTo(ox+r[0][0]*S,oy+r[0][1]*S);for(let j=1;j<r.length;j++)ctx.lineTo(ox+r[j][0]*S,oy+r[j][1]*S);ctx.closePath();if(fill){ctx.globalAlpha=alpha;ctx.fillStyle=fill;ctx.fill();ctx.globalAlpha=1;}if(stroke){ctx.setLineDash(dash||[]);ctx.lineWidth=lw;ctx.strokeStyle=stroke;ctx.stroke();ctx.setLineDash([]);}}}
function fArrow(A,B,col,wd,dash){const ang=Math.atan2(B[1]-A[1],B[0]-A[0]),hl=Math.min(18,Math.hypot(B[0]-A[0],B[1]-A[1])*.4),E=[B[0]-Math.cos(ang)*hl*.8,B[1]-Math.sin(ang)*hl*.8];ctx.setLineDash(dash||[]);ctx.beginPath();ctx.moveTo(A[0],A[1]);ctx.lineTo(E[0],E[1]);ctx.lineWidth=wd;ctx.strokeStyle=col;ctx.lineCap='round';ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(B[0],B[1]);ctx.lineTo(B[0]-Math.cos(ang-.45)*hl,B[1]-Math.sin(ang-.45)*hl);ctx.lineTo(B[0]-Math.cos(ang+.45)*hl,B[1]-Math.sin(ang+.45)*hl);ctx.closePath();ctx.fillStyle=col;ctx.fill();}
function fLabel(t,x,y,bold,col){ctx.font=(bold?'800 12px':'600 11px')+' Inter,"Malgun Gothic",sans-serif';ctx.lineWidth=3.5;ctx.strokeStyle='rgba(255,255,255,.92)';ctx.strokeText(t,x,y);ctx.fillStyle=col||'#2e2b4f';ctx.fillText(t,x,y);}
let fOldVis=0;
function drawForm(w,h,S,ox,oy,vx0,vx1,vy0,vy1){
  const M=FM.meta[fPer],P=FM.periods[M.key],pc=M.color,P2=m=>[ox+m[0]*S,oy+m[1]*S];
  if(basemapSel.value!=='none'){ctx.fillStyle='rgba(247,242,235,.5)';ctx.fillRect(0,0,w,h);}
  if(fLayers.area){fRings(P.housingM,S,ox,oy,'#cfaea6',.55);fRings(P.industryM,S,ox,oy,'#7d82a6',.5);if(P.gyodongAreaM)fRings(P.gyodongAreaM,S,ox,oy,pc,.3);}
  if(fLayers.bld){const st=M.start,en=M.end;
    if(zoom<1.6){const d=1.6;for(const f of features){const y=f[12];if(y==null||y>en)continue;if(f[4]<vx0||f[4]>vx1||f[5]<vy0||f[5]>vy1)continue;ctx.fillStyle=y>=st?pc:'#5b5870';ctx.globalAlpha=.8;ctx.fillRect(ox+f[4]*S-d/2,oy+f[5]*S-d/2,d,d);}ctx.globalAlpha=1;}
    else for(const pass of [0,1,2]){for(const f of features){const e=f[10];if(e[2]<vx0||e[0]>vx1||e[3]<vy0||e[1]>vy1)continue;const y=f[12],g=y==null||y>en?0:y<st?1:2;if(g!==pass)continue;ctx.fillStyle=g===2?pc:g===1?'#5b5870':'#c9c9d3';ctx.globalAlpha=g===0?.5:.88;
      if((e[2]-e[0])*S<1.2&&(e[3]-e[1])*S<1.2){ctx.fillRect(ox+f[4]*S-.6,oy+f[5]*S-.6,1.2,1.2);continue;}footprintPath(f,ox,oy,S);ctx.fill('evenodd');}}
    ctx.globalAlpha=1;}
  if(fLayers.old30){ // 사용승인 후 30년 이상(분석 기준일 2026.11.04) — 건물 위, 시가지 윤곽선·논문 주석 아래
    let vis=0;ctx.fillStyle=OLD_C;
    if(zoom<1.6){ctx.globalAlpha=.75;const d=2;for(const f of features){if(f[0]<3||f[0]>10)continue;if(f[4]<vx0||f[4]>vx1||f[5]<vy0||f[5]>vy1)continue;vis++;ctx.fillRect(ox+f[4]*S-d/2,oy+f[5]*S-d/2,d,d);}}
    else{ctx.lineJoin='round';for(const f of features){if(f[0]<3||f[0]>10)continue;const e=f[10];if(e[2]<vx0||e[0]>vx1||e[3]<vy0||e[1]>vy1)continue;vis++;
      if((e[2]-e[0])*S<2&&(e[3]-e[1])*S<2){ctx.globalAlpha=.78;ctx.fillRect(ox+f[4]*S-1,oy+f[5]*S-1,2,2);continue;}
      footprintPath(f,ox,oy,S);ctx.globalAlpha=1;ctx.globalAlpha=.78;ctx.fill('evenodd');ctx.globalAlpha=.9;ctx.lineWidth=.6;ctx.strokeStyle='#7d3550';ctx.stroke();}}
    ctx.globalAlpha=1;fOldVis=vis;}
  if(fLayers.area){if(P.gyodongAreaM)fRings(P.gyodongAreaM,S,ox,oy,null,0,pc,2.4);fRings(P.newAreaM,S,ox,oy,null,0,'#ffffff',4.5);fRings(P.newAreaM,S,ox,oy,null,0,pc,2.4);}
  // 분석 범위
  const bb=FM.bbox,B0=P2(LL([bb[0],bb[3]])),B1=P2(LL([bb[2],bb[1]]));ctx.setLineDash([6,5]);ctx.lineWidth=1.2;ctx.strokeStyle='#607089';ctx.strokeRect(B0[0],B0[1],B1[0]-B0[0],B1[1]-B0[1]);ctx.setLineDash([]);
  ctx.textAlign='left';ctx.textBaseline='bottom';fLabel('분석 범위(논문 대상 시가지 개략)',B0[0]+4,B0[1]-3,false,'#607089');
  if(fLayers.notes){const N=FM.notes[M.key];ctx.textAlign='center';ctx.textBaseline='middle';
    for(const n of N){if(n.kind!=='zone')continue;const p=P2(n.m),k=S/mPerWorld(n.at[1]);ctx.beginPath();ctx.ellipse(p[0],p[1],n.rx*k,n.ry*k,0,0,Math.PI*2);ctx.globalAlpha=.22;ctx.fillStyle=n.cat==='industry'?'#7d82a6':'#cfaea6';ctx.fill();ctx.globalAlpha=1;ctx.setLineDash([7,5]);ctx.lineWidth=2.2;ctx.strokeStyle=pc;ctx.stroke();ctx.setLineDash([]);}
    for(const n of N){if(n.kind==='axis'&&n.pm.length>1){const ps=n.pm.map(P2);for(let i=0;i<ps.length-1;i++){if(i<ps.length-2){ctx.setLineDash(n.approx?[10,6]:[]);ctx.beginPath();ctx.moveTo(ps[i][0],ps[i][1]);ctx.lineTo(ps[i+1][0],ps[i+1][1]);ctx.lineWidth=5;ctx.strokeStyle=pc;ctx.lineCap='round';ctx.stroke();ctx.setLineDash([]);}else fArrow(ps[i],ps[i+1],pc,5,n.approx?[10,6]:[]);}}
      if(n.kind==='arrow')fArrow(P2(n.fm),P2(n.tm),pc,4.5);}
    for(const n of N){const p=n.kind==='arrow'?P2([(n.fm[0]+n.tm[0])/2,(n.fm[1]+n.tm[1])/2]):n.kind==='axis'?P2(n.pm[n.pm.length-1]):P2(n.m);
      ctx.beginPath();ctx.arc(p[0],p[1],10,0,Math.PI*2);ctx.fillStyle=pc;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();ctx.fillStyle='#fff';ctx.font='800 11px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(n.no),p[0],p[1]+.5);
      ctx.textAlign='left';fLabel(n.title,p[0]+14,p[1],true);}}
  document.getElementById('mapnote').textContent=(fLayers.old30?'30년 이상 건축물 '+fmt(fOldVis)+'동(화면 안) · ':'')+'도시형태 · '+M.label+' '+M.range+' '+M.title+' · 박훈(2020) 기반 · 휠 확대 / 드래그 이동 · '+BASE_ATTR;}
function renderForm(){
  for(const b of fBtns.children)b.setAttribute('aria-pressed',String(Number(b.dataset.i)===fPer));
  const M=FM.meta[fPer],P=FM.periods[M.key],PS=FM.paper[M.key],D=P.dataStats,N=FM.notes[M.key];
  document.getElementById('formHead').innerHTML='<article class="metric" style="grid-column:1/-1;border-left:5px solid '+M.color+'"><div class="k">'+M.label+' '+M.range+'</div><strong class="txt">'+esc(M.title)+'</strong><small>공간정치 관점: '+esc(M.politics)+'</small></article>'+(fLayers.old30?'<article class="metric" style="grid-column:1/-1;border-left:5px solid '+OLD_C+'"><div class="k">사용승인 30년 이상 건축물 (분석 기준일 2026.11.04, 1996.11.04 이전 승인)</div><strong style="color:'+OLD_C+'">'+fmt(old30N)+'동</strong><small>삼척시 전체 · 승인일 유효 건물 중 '+pct(old30N,payload.validCount)+'. 시기 버튼과 관계없이 현재 기준으로 항상 표시</small></article>':'');
  const ul=document.getElementById('formNotes');ul.innerHTML='';
  for(const n of N){const li=document.createElement('li');li.tabIndex=0;li.innerHTML='<i class="num-key" style="background:'+M.color+'">'+n.no+'</i><span><b>'+esc(n.title)+'</b><br>'+esc(n.text)+(n.approx?' <small>(위치 개략)</small>':'')+' <small>— 논문 '+esc(n.ref)+'</small></span>';
    const go=()=>{const m=n.m||(n.fm?[(n.fm[0]+n.tm[0])/2,(n.fm[1]+n.tm[1])/2]:n.pm[1]);goTo(m,Math.max(zoom,40));};li.addEventListener('click',go);li.addEventListener('keydown',e=>{if(e.key==='Enter')go();});ul.append(li);}
  const f1=v=>v.toFixed(1)+'%';
  document.getElementById('formCompare').innerHTML='<thead><tr><th>'+M.label+' 건축물</th><th>논문</th><th>이 데이터</th></tr></thead><tbody>'+
    '<tr><td>건물 수</td><td>'+fmt(PS.n)+'</td><td>'+fmt(D.n)+'</td></tr><tr><td>단독주택 비율</td><td>'+f1(PS.detached)+'</td><td>'+(D.n?f1(D.detached):'–')+'</td></tr><tr><td>1층 건물 비율</td><td>'+f1(PS.oneFloor)+'</td><td>'+(D.n?f1(D.oneFloor):'–')+'</td></tr><tr><td>5층 이상 비율</td><td>'+f1(PS.five)+'</td><td>'+(D.n?f1(D.five):'–')+'</td></tr></tbody>';
  const extra=fPer===0?'<b>1기 지도</b>: 분석 범위 안에서 1956년 이전 사용승인일이 남은 현존 건물은 '+fmt(D.n)+'건뿐이라 시가지 윤곽을 데이터로 그릴 수 없습니다. 점선 타원은 논문 서술(성내동·읍상동, 정라진, 오노다 공장)을 지명 위치에 옮긴 개략 범위이며, 실제 경계가 아닙니다.<br><br>':fPer===2?'<b>교동 택지</b>: 교동사무소 북동쪽 구릉지의 1995–2005년 승인 5층 이상 공동주택 '+fmt(P.gyodongApts)+'동으로 범위를 그렸습니다.<br><br>':'';
  document.getElementById('formDisc').innerHTML=extra+'<b>자료와 한계</b><br>시기 구분·사건·형태 서술은 박훈(2020), 「삼척시 지적자료 분석을 통한 근·현대 도시형태 변화 연구」(대한건축학회연합논문집 22(1), 27–38쪽)에서 가져왔습니다. 위치는 건물 데이터의 건물명(죽서루, 성내·정라·남양·교동 동사무소, 동양시멘트 삼척공장, 수협, 시청, 중앙시장)으로 잡았습니다. 대학로 축은 죽서루–성내동 방향을 북쪽으로 연장한 개략선입니다. 주거·산업지역 윤곽은 논문 Figure 7·8의 범례를 따라, 시기 말까지 사용승인된 현존 건물의 밀도로 그렸습니다. 논문은 지적도·현장조사로 멸실 건물까지 다루지만 이 데이터는 현존 건물만 있어 과거 시기일수록 작게 나타납니다. 비교표의 논문 값은 건축물대장 확인 3,935동 기준(Table 14), 이 데이터 값은 분석 범위 안 해당 시기 승인 건물 기준입니다.';}
renderForm();
// ---------- 도시형태2: 3기 세분 ----------
const F2=FM.form2,F2C='#4b7bb5';let f2i=1,f2Play=null;const f2L={blobs:true,cum:true,notes:true,shift:true,bld:true};
F2.gy95M=F2.gy95.map(r=>r.map(LL));F2.gy00M=F2.gy00.map(r=>r.map(LL));
for(const e of F2.sub){e.housingM=e.housing.map(r=>r.map(LL));e.industryM=e.industry.map(r=>r.map(LL));for(const b of e.blobs){b.m=b.ring.map(LL);b.am=LL(b.at);}if(e.shift){e.shift.fm=LL(e.shift.from);e.shift.tm=LL(e.shift.to);}e.notes.forEach((n,i)=>{n.no=i+1;if(n.at)n.m=LL(n.at);if(n.from){n.fm=LL(n.from);n.tm=LL(n.to);}if(n.path)n.pm=n.path.map(LL);});}
const f2Chips=document.getElementById('f2Chips');
for(const [k,l] of [['blobs','신규 개발지'],['cum','누적 시가지'],['notes','논문 주석'],['shift','신축 무게중심'],['bld','건물']]){const b=document.createElement('button');b.textContent=l;b.setAttribute('aria-pressed','true');b.addEventListener('click',()=>{f2L[k]=!f2L[k];b.setAttribute('aria-pressed',String(f2L[k]));draw();});f2Chips.append(b);}
const f2Btns=document.getElementById('f2Btns');
F2.sub.forEach((e,i)=>{const b=document.createElement('button');b.textContent=e.label;b.dataset.i=i;b.addEventListener('click',()=>{stopF2Play();f2i=i;renderForm2();draw();});f2Btns.append(b);});
function stopF2Play(){if(f2Play){clearInterval(f2Play);f2Play=null;document.getElementById('f2Play').textContent='▶ 구간 순서대로 재생';}}
document.getElementById('f2Play').addEventListener('click',()=>{if(f2Play){stopF2Play();return;}f2i=0;renderForm2();draw();document.getElementById('f2Play').textContent='■ 정지';f2Play=setInterval(()=>{f2i++;if(f2i>=F2.sub.length){f2i=F2.sub.length-1;stopF2Play();return;}renderForm2();draw();},1800);});
function drawForm2(w,h,S,ox,oy,vx0,vx1,vy0,vy1){
  const E=F2.sub[f2i],P2=m=>[ox+m[0]*S,oy+m[1]*S];
  if(basemapSel.value!=='none'){ctx.fillStyle='rgba(247,242,235,.5)';ctx.fillRect(0,0,w,h);}
  if(f2L.cum){fRings(E.housingM,S,ox,oy,'#cfaea6',.35);fRings(E.industryM,S,ox,oy,'#7d82a6',.32);}
  if(f2L.bld){const st=E.start,en=E.end;
    if(zoom<1.6){const d=1.6;for(const f of features){const y=f[12];if(y==null||y>en)continue;if(f[4]<vx0||f[4]>vx1||f[5]<vy0||f[5]>vy1)continue;ctx.fillStyle=y>=st?(f[11]>=0?PC[f[11]].color:'#8a8aa0'):'#5b5870';ctx.globalAlpha=.85;ctx.fillRect(ox+f[4]*S-d/2,oy+f[5]*S-d/2,d,d);}ctx.globalAlpha=1;}
    else for(const pass of [0,1,2]){for(const f of features){const e=f[10];if(e[2]<vx0||e[0]>vx1||e[3]<vy0||e[1]>vy1)continue;const y=f[12],g=y==null||y>en?0:y<st?1:2;if(g!==pass)continue;ctx.fillStyle=g===2?(f[11]>=0?PC[f[11]].color:'#8a8aa0'):g===1?'#5b5870':'#c9c9d3';ctx.globalAlpha=g===0?.45:g===1?.7:.95;
      if((e[2]-e[0])*S<1.2&&(e[3]-e[1])*S<1.2){ctx.fillRect(ox+f[4]*S-.6,oy+f[5]*S-.6,1.2,1.2);continue;}footprintPath(f,ox,oy,S);ctx.fill('evenodd');}}
    ctx.globalAlpha=1;}
  if(f2L.blobs){for(const b of E.blobs)fRings([b.m],S,ox,oy,PC[b.dom].color,.3,PC[b.dom].color,2.2);
    ctx.textAlign='center';ctx.textBaseline='middle';for(const b of E.blobs){if(b.n<Math.max(12,60/zoom))continue;const p=P2(b.am);fLabel(PC[b.dom].label+' '+fmt(b.n)+'동',p[0],p[1],false,'#2e2b4f');}}
  const bb=FM.bbox,B0=P2(LL([bb[0],bb[3]])),B1=P2(LL([bb[2],bb[1]]));ctx.setLineDash([6,5]);ctx.lineWidth=1.2;ctx.strokeStyle='#607089';ctx.strokeRect(B0[0],B0[1],B1[0]-B0[0],B1[1]-B0[1]);ctx.setLineDash([]);
  ctx.textAlign='left';ctx.textBaseline='bottom';fLabel('분석 범위(논문 대상 시가지 개략)',B0[0]+4,B0[1]-3,false,'#607089');
  if(f2L.shift&&E.shift){const A=P2(E.shift.fm),Bt=P2(E.shift.tm),k=Math.max(4,60/Math.max(1,Math.hypot(Bt[0]-A[0],Bt[1]-A[1]))),B2=[A[0]+(Bt[0]-A[0])*k,A[1]+(Bt[1]-A[1])*k];
    ctx.beginPath();ctx.arc(A[0],A[1],5,0,Math.PI*2);ctx.fillStyle='#b45309';ctx.fill();fArrow(A,B2,'#b45309',4);ctx.textAlign='left';ctx.textBaseline='middle';fLabel('신축 무게중심 '+E.shift.dir+' '+fmt(E.shift.m)+'m (길이 과장)',B2[0]+8,B2[1],false,'#b45309');}
  if(f2L.notes){ctx.textAlign='center';ctx.textBaseline='middle';
    for(const n of E.notes){if(n.kind==='area'){fRings(n.key==='gy95'?F2.gy95M:F2.gy00M,S,ox,oy,null,0,'#2e2b4f',2.2,[6,4]);}
      if(n.kind==='axis'&&n.pm.length>1){const ps=n.pm.map(P2);for(let i=0;i<ps.length-1;i++){if(i<ps.length-2){ctx.setLineDash([10,6]);ctx.beginPath();ctx.moveTo(ps[i][0],ps[i][1]);ctx.lineTo(ps[i+1][0],ps[i+1][1]);ctx.lineWidth=5;ctx.strokeStyle=F2C;ctx.lineCap='round';ctx.stroke();ctx.setLineDash([]);}else fArrow(ps[i],ps[i+1],F2C,5,[10,6]);}}
      if(n.kind==='arrow')fArrow(P2(n.fm),P2(n.tm),F2C,4.5);}
    for(const n of E.notes){const p=n.kind==='arrow'?P2([(n.fm[0]+n.tm[0])/2,(n.fm[1]+n.tm[1])/2]):n.kind==='axis'?P2(n.pm[n.pm.length-1]):P2(n.m);
      ctx.beginPath();ctx.arc(p[0],p[1],10,0,Math.PI*2);ctx.fillStyle=F2C;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();ctx.fillStyle='#fff';ctx.font='800 11px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(n.no),p[0],p[1]+.5);ctx.textAlign='left';fLabel(n.title,p[0]+14,p[1],true);}}
  document.getElementById('mapnote').textContent='도시형태2 · 3기 세분 '+E.label+' · 박훈(2020) + 건축물 승인연도 · 휠 확대 / 드래그 이동 · '+BASE_ATTR;}
function renderForm2(){
  for(const b of f2Btns.children)b.setAttribute('aria-pressed',String(Number(b.dataset.i)===f2i));
  const E=F2.sub[f2i],prev=F2.sub[f2i-1],tot=E.mix.reduce((a,b)=>a+b,0),pct1=(a,b)=>b?(a/b*100).toFixed(1)+'%':'–';
  const order=E.mix.map((v,i)=>[i,v]).sort((a,b)=>b[1]-a[1]),top=order[0],second=order[1];
  document.getElementById('f2Metrics').innerHTML='<article class="metric" style="grid-column:1/-1;border-left:5px solid '+F2C+'"><div class="k">3기 외연확장기 · 세분 구간</div><strong class="txt">'+esc(E.label)+'</strong><small>분석 범위 안 이 구간 사용승인 현존 건물</small></article>'+
    '<article class="metric"><div class="k">신축 건물</div><strong>'+fmt(E.n)+'</strong><small>'+(E.paper?'논문 '+E.paper.label+': '+fmt(E.paper.n)+'동':'논문(2020) 이후 구간')+'</small></article>'+
    '<article class="metric"><div class="k">5층 이상</div><strong>'+pct1(E.five,E.n)+'</strong><small>'+fmt(E.five)+'동 · 고밀주거지 '+fmt(E.apt)+'동</small></article>';
  const mix=document.getElementById('f2Mix');mix.innerHTML=E.mix.map((v,i)=>v?'<i style="width:'+(v/tot*100)+'%;background:'+PC[i].color+'" data-tip="'+PC[i].label+' '+fmt(v)+'동 ('+pct1(v,tot)+')"></i>':'').join('');
  document.getElementById('f2Keys').innerHTML=E.mix.map((v,i)=>v?'<span><i class="swatch" style="background:'+PC[i].color+'"></i>'+PC[i].label+' '+pct1(v,tot)+'</span>':'').join('');
  const ins=[];
  ins.push('이 구간 신축 '+fmt(E.n)+'동 중 <b>'+PC[top[0]].label+' '+pct1(top[1],tot)+'</b>, '+PC[second[0]].label+' '+pct1(second[1],tot)+'입니다.');
  if(prev)ins.push('직전 구간('+esc(prev.label)+') '+fmt(prev.n)+'동보다 신축이 <b>'+(E.n>=prev.n?'+':'')+fmt(E.n-prev.n)+'동</b> '+(E.n>=prev.n?'늘었습니다':'줄었습니다')+'.');
  const big=E.blobs[0];if(big)ins.push('가장 큰 신규 개발지는 <b>'+PC[big.dom].label+' 중심('+Math.round(big.share*100)+'%) '+fmt(big.n)+'동</b> 규모입니다. 신규 개발지 '+E.blobs.length+'곳(8동 이상).');else ins.push('8동 이상 모인 신규 개발지가 없습니다. 신축이 기존 시가지 안에 흩어져 들어섰습니다(내부 충진).');
  if(E.shift)ins.push('이전까지 지어진 건물 대비 이 구간 신축의 무게중심이 <b>'+E.shift.dir+'쪽으로 '+fmt(E.shift.m)+'m</b> 옮겨갔습니다.');
  ins.push('5층 이상 비율은 '+pct1(E.five,E.n)+'입니다'+(prev?' (직전 '+pct1(prev.five,prev.n)+')':'')+'. 논문은 3기 전체 5층 이상을 8.9%로 보고했습니다.');
  document.getElementById('f2Insights').innerHTML=ins.map(t=>'<li>'+t+'</li>').join('');
  const ul=document.getElementById('f2Notes');ul.innerHTML='';
  if(!E.notes.length)ul.innerHTML='<li style="cursor:default;grid-template-columns:1fr"><span>논문('+(E.key==='e2020'?'2020년 발표, 2019년 조사':'')+')에 이 구간을 직접 다룬 서술이 없습니다. 지도는 건물 데이터만으로 그렸습니다.</span></li>';
  for(const n of E.notes){const li=document.createElement('li');li.tabIndex=0;li.innerHTML='<i class="num-key" style="background:'+F2C+'">'+n.no+'</i><span><b>'+esc(n.title)+'</b><br>'+esc(n.text)+(n.approx?' <small>(위치 개략)</small>':'')+' <small>— 논문 '+esc(n.ref)+'</small></span>';
    const go=()=>{const m=n.m||(n.fm?[(n.fm[0]+n.tm[0])/2,(n.fm[1]+n.tm[1])/2]:n.pm[1]);goTo(m,Math.max(zoom,40));};li.addEventListener('click',go);li.addEventListener('keydown',e=>{if(e.key==='Enter')go();});ul.append(li);}
  const tb=document.getElementById('f2Table');
  tb.innerHTML='<thead><tr><th>구간</th><th>데이터</th><th>논문</th><th>5층+</th><th>주 용도</th></tr></thead><tbody>'+F2.sub.map((e,i)=>{const t=e.mix.reduce((a,b)=>a+b,0),d=e.mix.indexOf(Math.max(...e.mix));return '<tr class="click" data-i="'+i+'"'+(i===f2i?' style="font-weight:700"':'')+'><td>'+esc(e.label)+'</td><td>'+fmt(e.n)+'</td><td>'+(e.paper?fmt(e.paper.n):'–')+'</td><td>'+pct1(e.five,e.n)+'</td><td>'+PC[d].label+' '+pct1(e.mix[d],t)+'</td></tr>';}).join('')+'</tbody>';
  for(const tr of tb.querySelectorAll('tr.click'))tr.addEventListener('click',()=>{stopF2Play();f2i=+tr.dataset.i;renderForm2();draw();});
  document.getElementById('f2Disc').innerHTML='<b>방법</b><br>박훈(2020)의 3기(1982–현재, 외연확장기)를 공간구조도 탭과 같은 사용승인 연도 구간으로 나눴습니다(첫 구간만 1982년부터). 신규 개발지는 그 구간에 승인된 건물이 모인 곳의 밀도 윤곽이고, 색은 그 안에서 가장 많은 용도(공간구조도 범례)입니다. 신축 무게중심은 분석 범위 안에서 이전 구간까지의 건물과 이 구간 신축 건물의 평균 위치를 비교했고, 화살표 길이는 보이도록 과장했습니다. 논문 주석은 서술의 시점에 맞는 구간에 배치했습니다. 시점이 명시되지 않은 서술(중심 이동, 공동화)은 교동 택지 이후 구간과 논문 조사 시점(2019)에 두었습니다.<br><br><b>자료 한계</b><br>현존 건물 기준이라 멸실·재건축된 건물은 빠집니다. 논문 값은 시가화지역 건축물대장 확인 3,935동 기준(Table 14)이고 구간 경계(–1990 등)가 1년씩 다를 수 있습니다. 분석 범위는 논문 대상지(약 8.9km²)에 맞춘 개략 범위입니다.';
  buildLegend();
}
renderForm2();
// ---------- 도시형태3: 도시축소 3단계 (자료 표 + 도시형태 + 도시형태2 종합) ----------
var F3=payload.form3,f3i=0,f3L={area:true,notes:true,bld:true,old30:false,rail:true}; // var: 앞선 renderForm*()의 buildLegend 호출 시점에도 참조 가능
for(const k in F3.periods){const p=F3.periods[k];for(const n of ['housing','industry','newArea','gy95'])if(p[n])p[n+'M']=p[n].map(r=>r.map(LL));}
for(const k in F3.notes)F3.notes[k].forEach((n,i)=>{n.no=i+1;if(n.at)n.m=LL(n.at);if(n.from){n.fm=LL(n.from);n.tm=LL(n.to);}if(n.path)n.pm=n.path.map(LL);});
const f3Btns=document.getElementById('f3Btns');
F3.meta.forEach((m,i)=>{const b=document.createElement('button');b.innerHTML=m.label+' · '+m.range+'<br><small style="font-weight:600">'+m.title+'</small>';b.dataset.i=i;b.addEventListener('click',()=>{f3i=i;renderForm3();draw();});f3Btns.append(b);});
const f3Views=document.getElementById('f3Views');
function f3View(v){const A=F3.anchors;if(v==='all'){fitView();return;}if(v==='city'){fitForm();return;}if(v==='dogye'&&A.dogye)goTo(LL(A.dogye),28);}
for(const [v,l] of [['all','시 전체'],['city','삼척 시가지'],['dogye','도계']]){const b=document.createElement('button');b.textContent=l;b.addEventListener('click',()=>f3View(v));f3Views.append(b);}
const f3Chips=document.getElementById('f3Chips');
for(const [k,l] of [['area','시가지 윤곽'],['notes','지도 주석'],['bld','건물'],['rail','철도'],['old30','30년 이상 건축물']]){const b=document.createElement('button');b.textContent=l;b.setAttribute('aria-pressed',String(f3L[k]));b.addEventListener('click',()=>{f3L[k]=!f3L[k];b.setAttribute('aria-pressed',String(f3L[k]));buildLegend();draw();});f3Chips.append(b);}
const NOTE_C={core:'#1f5f86',shrink:'#c2410c',grow:'#15803d',ring:'#15803d'};
function drawForm3(w,h,S,ox,oy,vx0,vx1,vy0,vy1){
  const M=F3.meta[f3i],P=F3.periods[M.key],pc=M.color,P2=m=>[ox+m[0]*S,oy+m[1]*S];
  if(basemapSel.value!=='none'){ctx.fillStyle='rgba(247,242,235,.5)';ctx.fillRect(0,0,w,h);}
  if(f3L.area){fRings(P.housingM,S,ox,oy,'#cfaea6',.55);fRings(P.industryM,S,ox,oy,'#7d82a6',.5);if(P.gy95M)fRings(P.gy95M,S,ox,oy,pc,.25);}
  if(f3L.bld){const st=M.start,en=M.end;
    if(zoom<1.6){const d=1.6;for(const f of features){const y=f[12];if(y==null||y>en)continue;if(f[4]<vx0||f[4]>vx1||f[5]<vy0||f[5]>vy1)continue;ctx.fillStyle=y>=st?pc:'#5b5870';ctx.globalAlpha=.8;ctx.fillRect(ox+f[4]*S-d/2,oy+f[5]*S-d/2,d,d);}ctx.globalAlpha=1;}
    else for(const pass of [0,1,2]){for(const f of features){const e=f[10];if(e[2]<vx0||e[0]>vx1||e[3]<vy0||e[1]>vy1)continue;const y=f[12],g=y==null||y>en?0:y<st?1:2;if(g!==pass)continue;ctx.fillStyle=g===2?pc:g===1?'#5b5870':'#c9c9d3';ctx.globalAlpha=g===0?.45:.88;
      if((e[2]-e[0])*S<1.2&&(e[3]-e[1])*S<1.2){ctx.fillRect(ox+f[4]*S-.6,oy+f[5]*S-.6,1.2,1.2);continue;}footprintPath(f,ox,oy,S);ctx.fill('evenodd');}}
    ctx.globalAlpha=1;}
  if(f3L.old30){ctx.fillStyle=OLD_C;ctx.globalAlpha=.78;for(const f of features){if(f[0]<3||f[0]>10)continue;const e=f[10];if(e[2]<vx0||e[0]>vx1||e[3]<vy0||e[1]>vy1)continue;if(zoom<1.6||((e[2]-e[0])*S<2&&(e[3]-e[1])*S<2)){ctx.fillRect(ox+f[4]*S-1,oy+f[5]*S-1,2,2);continue;}footprintPath(f,ox,oy,S);ctx.fill('evenodd');}ctx.globalAlpha=1;}
  if(f3L.rail&&RAIL.length){ctx.lineCap='butt';ctx.lineJoin='round';for(const [wd,col,dash] of [[2.2,'#3d3a5c',[]],[1,'#ffffff',[4,4]]]){ctx.setLineDash(dash);ctx.lineWidth=wd;ctx.strokeStyle=col;for(const r of RAIL){ctx.beginPath();let p=P2(r.m[0]);ctx.moveTo(p[0],p[1]);for(let j=1;j<r.m.length;j++){p=P2(r.m[j]);ctx.lineTo(p[0],p[1]);}ctx.stroke();}}ctx.setLineDash([]);}
  if(f3L.area){fRings(P.newAreaM,S,ox,oy,null,0,'#ffffff',4);fRings(P.newAreaM,S,ox,oy,null,0,pc,2.2);if(P.gy95M)fRings(P.gy95M,S,ox,oy,null,0,'#2e2b4f',2.2,[6,4]);}
  if(f3L.notes){const N=F3.notes[M.key],mpw=lat=>40075016.7*Math.cos(lat*Math.PI/180);
    for(const n of N){if(!n.r||!n.m)continue;const p=P2(n.m),rr=Math.max(14,n.r*S/mpw(n.at[1])),col=NOTE_C[n.kind]||pc;ctx.beginPath();ctx.arc(p[0],p[1],rr,0,Math.PI*2);ctx.globalAlpha=.13;ctx.fillStyle=col;ctx.fill();ctx.globalAlpha=1;ctx.setLineDash(n.kind==='shrink'?[7,5]:[]);ctx.lineWidth=2.6;ctx.strokeStyle=col;ctx.stroke();ctx.setLineDash([]);
      if(n.kind==='shrink'||n.kind==='grow'){const s2=n.kind==='grow'?1:-1;for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const x1=p[0]+Math.cos(a)*rr,y1=p[1]+Math.sin(a)*rr,x2=p[0]+Math.cos(a)*(rr+s2*Math.min(16,rr*.35)),y2=p[1]+Math.sin(a)*(rr+s2*Math.min(16,rr*.35));fArrow([x1,y1],[x2,y2],col,2.4);}}}
    for(const n of N){if(n.kind==='link'){ctx.setLineDash([12,7]);ctx.beginPath();const A=P2(n.fm),B=P2(n.tm);ctx.moveTo(A[0],A[1]);ctx.lineTo(B[0],B[1]);ctx.lineWidth=5;ctx.strokeStyle=pc;ctx.globalAlpha=.75;ctx.lineCap='round';ctx.stroke();ctx.globalAlpha=1;ctx.setLineDash([]);}
      if(n.kind==='arrow')fArrow(P2(n.fm),P2(n.tm),pc,4.5);
      if(n.kind==='edge'){const A=P2(n.m),k=n.len*S/mpw(n.at[1]),B=[A[0]+n.dir[0]*Math.max(60,k),A[1]-n.dir[1]*Math.max(60,k)];fArrow(A,B,'#c2410c',4,[8,6]);}
      if(n.kind==='axis'&&n.pm.length>1){const ps=n.pm.map(P2);ctx.setLineDash([10,6]);ctx.beginPath();ctx.moveTo(ps[0][0],ps[0][1]);for(let i=1;i<ps.length-1;i++)ctx.lineTo(ps[i][0],ps[i][1]);ctx.lineWidth=4;ctx.strokeStyle=pc;ctx.lineCap='round';ctx.stroke();ctx.setLineDash([]);fArrow(ps[ps.length-2],ps[ps.length-1],pc,4,[10,6]);}
      if(n.kind==='ring'){const p=P2(n.m),bb=F3.cityBox,B0=P2(LL([bb[0],bb[3]])),B1=P2(LL([bb[2],bb[1]]));ctx.setLineDash([3,4]);ctx.lineWidth=2.4;ctx.strokeStyle='#15803d';ctx.strokeRect(B0[0],B0[1],B1[0]-B0[0],B1[1]-B0[1]);ctx.setLineDash([]);}}
    for(const n of N){let p;if(n.kind==='link'||n.kind==='arrow')p=P2([(n.fm[0]+n.tm[0])/2,(n.fm[1]+n.tm[1])/2]);else if(n.kind==='axis')p=P2(n.pm[n.pm.length-1]);else if(n.kind==='edge'){const A=P2(n.m),k=n.len*S/mpw(n.at[1]);p=[A[0]+n.dir[0]*Math.max(60,k),A[1]-n.dir[1]*Math.max(60,k)];}else if(n.kind==='ring'){const bb=F3.cityBox;p=P2(LL([bb[0],bb[3]]));p=[p[0]+12,p[1]+12];}else p=P2(n.m);
      const col=NOTE_C[n.kind]||pc;ctx.beginPath();ctx.arc(p[0],p[1],10,0,Math.PI*2);ctx.fillStyle=col;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();ctx.fillStyle='#fff';ctx.font='800 11px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(n.no),p[0],p[1]+.5);ctx.textAlign='left';fLabel(n.title,p[0]+14,p[1],true);}}
  document.getElementById('mapnote').textContent='도시형태3 · '+M.label+' '+M.range+' '+M.title+' · 휠 확대 / 드래그 이동 · '+BASE_ATTR+(RAIL.length?' · 철도 © OpenStreetMap':'');}
function renderForm3(){
  for(const b of f3Btns.children)b.setAttribute('aria-pressed',String(Number(b.dataset.i)===f3i));
  const M=F3.meta[f3i],P=F3.periods[M.key],pct1=(a,b)=>b?(a/b*100).toFixed(1)+'%':'–';
  document.getElementById('f3Head').innerHTML='<article class="metric" style="border-left:5px solid '+M.color+'"><div class="k">'+M.label+' · '+M.range+'</div><strong class="txt">'+esc(M.title)+'</strong></article><div class="sum3"><b>인구</b> '+esc(M.pop)+'<br><b>공간</b> '+esc(M.space)+'<br><b>신축 건물(현존, 승인 기준)</b> '+fmt(P.n)+'동 · 5층 이상 '+pct1(P.five,P.n)+'</div>';
  document.getElementById('f3Tl').innerHTML=F3.timeline[M.key].map(([y,t])=>'<li><b style="color:'+M.color+'">'+esc(y)+'</b><span>'+esc(t)+'</span></li>').join('');
  const SRC={user:'자료 표','user+paper':'자료 표·도시형태','paper+user':'도시형태·자료 표',paper:'도시형태(박훈 2020)',data:'건물 데이터'};
  const ul=document.getElementById('f3Notes');ul.innerHTML='';
  for(const n of F3.notes[M.key]){const col=NOTE_C[n.kind]||M.color,li=document.createElement('li');li.tabIndex=0;li.innerHTML='<i class="num-key" style="background:'+col+'">'+n.no+'</i><span><b>'+esc(n.title)+'</b><br>'+esc(n.text)+(n.approx?' <small>(위치 개략)</small>':'')+' <small>— '+SRC[n.src]+' · '+esc(n.ref)+'</small></span>';
    const go=()=>{const m=n.m||(n.fm?[(n.fm[0]+n.tm[0])/2,(n.fm[1]+n.tm[1])/2]:n.pm[1]);goTo(m,Math.max(zoom,n.kind==='core'||n.kind==='shrink'||n.kind==='link'?14:36));};li.addEventListener('click',go);li.addEventListener('keydown',e=>{if(e.key==='Enter')go();});ul.append(li);}
  const RC={city:['삼척 시가지','#1f5f86'],dogye:['도계(읍사무소 4km)','#c2410c'],other:['그 밖의 읍면','#a8a29e']};
  const reg=document.getElementById('f3Reg');reg.innerHTML='';
  F3.meta.forEach((m,i)=>{const p=F3.periods[m.key],t=p.n,row=document.createElement('div');row.className='stackrow'+(i===f3i?' active':'');row.style.cursor='pointer';row.innerHTML='<span'+(i===f3i?' style="font-weight:800;color:#132238"':'')+'>'+m.label+' '+m.range+'</span><div class="regbar">'+Object.keys(RC).map(k=>p.reg[k]?'<i style="width:'+(p.reg[k]/t*100)+'%;background:'+RC[k][1]+'" data-tip="'+m.label+' · '+RC[k][0]+' '+fmt(p.reg[k])+'동 ('+pct1(p.reg[k],t)+')"></i>':'').join('')+'</div>';row.addEventListener('click',()=>{f3i=i;renderForm3();draw();});reg.append(row);});
  document.getElementById('f3RegKeys').innerHTML=Object.values(RC).map(([l,c])=>'<span><i class="swatch" style="background:'+c+'"></i>'+l+'</span>').join('');
  const mx2=document.getElementById('f3Mix');mx2.innerHTML='';
  F3.meta.forEach((m,i)=>{const p=F3.periods[m.key],t=p.mix.reduce((a,b)=>a+b,0),row=document.createElement('div');row.className='stackrow';row.innerHTML='<span'+(i===f3i?' style="font-weight:800;color:#132238"':'')+'>'+m.label+'</span><div class="stack">'+p.mix.map((v,k)=>v?'<i style="width:'+(v/t*100)+'%;background:'+PC[k].color+'" data-tip="'+m.label+' · '+PC[k].label+' '+fmt(v)+'동 ('+pct1(v,t)+')"></i>':'').join('')+'</div>';mx2.append(row);});
  document.getElementById('f3Disc').innerHTML='<b>종합 방법</b><br>시기 구분·연표·인구·공간 요약은 제공해 주신 「삼척시 도시축소는 1989년과 2005년을 기점으로 세 시기로 나뉜다」 자료를 그대로 옮겼습니다. 지도에는 이 내용을 위치에 맞춰 표시하고(도계읍사무소, 시청, 도계광업소 등 건물명으로 위치 확인), 도시형태 탭(박훈 2020: 남양동 신시가지·삼척항·동양시멘트·교동 택지·대학로·중앙시장 공동화)과 도시형태2 탭(교동 택지 공동주택 범위)의 정보를 같은 시기에 겹쳤습니다. 주거·산업 윤곽과 신규 시가지는 현존 건물의 사용승인 연도로 그렸습니다. 지역 분포의 삼척 시가지는 도시형태 탭 분석 범위, 도계는 도계읍사무소 반경 4km입니다.<br><br><b>자료 한계</b><br>인구 축소는 건물 데이터로 직접 보이지 않습니다. 현존 건물만 있어 폐광 후 철거된 탄광 주거지는 빠지고, 축소기에도 신축이 계속 나타납니다. 그래서 축소·성장 표시(주황 점선·초록 원)는 자료 표의 인구 서술을 옮긴 것이고 경계는 개략입니다. "시내 4개 동"은 행정동 경계가 아니라 분석 범위 사각형으로 대신 표시했습니다.<br><br><small>'+esc(F3.source)+'</small>';
  buildLegend();
}
renderForm3();
setTab(tab);fitView();
}
// 건물 데이터는 별도 파일(gzip 전송)로 비동기 로드 — file:// 에서도 동작하도록 script 태그 사용
(function(){const s=document.createElement('script');s.src='building_age_data.js?v=__DATAVER__';s.async=true;
  s.onload=()=>{if(!window.__PAYLOAD){document.getElementById('mapnote').textContent='건물 데이터를 읽지 못했습니다.';return;}__main(window.__PAYLOAD);};
  s.onerror=()=>{document.getElementById('mapnote').textContent='건물 데이터 파일(building_age_data.js)을 불러오지 못했습니다.';};
  document.body.append(s);})();
</script>
</body></html>`;

const payload = JSON.stringify({
  features: compact,
  labels,
  colors,
  counts,
  bounds: [minLon, minLat, maxLon, maxLat],
  validCount,
  old30,
  useStats,
  ageBins: AGE_BINS,
  potato,
  rail,
  form: computeUrbanForm(source.features),
  form3: computeUrbanForm3(source.features),
});
const dataVer = (await import('node:crypto')).createHash('sha1').update(payload).digest('hex').slice(0, 10);
const html = template.replace('__BOUNDS__', () => JSON.stringify([minLon, minLat, maxLon, maxLat])).replace('__DATAVER__', dataVer);
const outPath = path.join(reportDir, 'building_age_preview.html');
await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(outPath, html, 'utf8');
const dataPath2 = path.join(reportDir, 'building_age_data.js');
await fs.writeFile(dataPath2, '// create_preview.mjs 가 생성한 지도 데이터\nwindow.__PAYLOAD=' + payload + ';\n', 'utf8');

// 브이월드 키는 HTML에 넣지 않고 같은 폴더의 vworld_key.js 로 분리한다 (공유 금지).
const envText = await fs.readFile(path.resolve(projectDir, '..', '.env'), 'utf8').catch(() => '');
const vworldKey = envText.match(/^\s*V-WORLD_KEY\s*=\s*["']?([^"'\r\n]+)/m)?.[1]?.trim();
if (vworldKey) {
  if (html.includes(vworldKey)) throw new Error('HTML에 브이월드 키가 포함됨');
  await fs.writeFile(path.join(reportDir, 'vworld_key.js'), `// .env 에서 생성됨. 공유·커밋 금지\nwindow.VWORLD_KEY = ${JSON.stringify(vworldKey)};\n`, 'utf8');
} else {
  console.warn('.env 에 V-WORLD_KEY 가 없어 배경지도 없이 표시됩니다.');
}
console.log(`미리보기 작성: ${outPath} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB) + 데이터 ${(Buffer.byteLength(payload) / 1024 / 1024).toFixed(1)} MB`);
