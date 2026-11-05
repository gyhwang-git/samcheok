import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(here, '..');
const rootDir = path.resolve(projectDir, '..');
const rawDir = path.join(projectDir, 'data', 'raw');
const processedDir = path.join(projectDir, 'data', 'processed');
const reportDir = path.join(projectDir, 'reports');
const apiUrl = 'https://api.vworld.kr/req/data';
const cityCode = '51230';
const analysisDate = new Date('2026-11-04T00:00:00Z');
const pageSize = 1000;

function readKey(text) {
  const line = text.split(/\r?\n/).find((row) => /^\s*V-WORLD_KEY\s*=/.test(row));
  if (!line) throw new Error('상위 폴더 .env에서 V-WORLD_KEY를 찾지 못했습니다.');
  const value = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!value) throw new Error('V-WORLD_KEY 값이 비어 있습니다.');
  return value;
}

async function requestData(key, { data, bbox, page = 1, size = pageSize }) {
  const params = new URLSearchParams({
    service: 'data', version: '2.0', request: 'GetFeature', data,
    format: 'json', key, domain: 'localhost', page: String(page), size: String(size),
    geometry: 'true', attribute: 'true', crs: 'EPSG:4326', geomFilter: `BOX(${bbox.join(',')})`,
  });
  const response = await fetch(`${apiUrl}?${params}`);
  if (!response.ok) throw new Error(`브이월드 HTTP 오류: ${response.status}`);
  const body = await response.json();
  if (body?.response?.status !== 'OK') {
    const message = body?.response?.error?.text || body?.response?.status || '알 수 없는 오류';
    throw new Error(`브이월드 API 오류: ${message}`);
  }
  return body.response.result.featureCollection.features || [];
}

function collectPositions(value, out = []) {
  if (!Array.isArray(value)) return out;
  if (typeof value[0] === 'number' && typeof value[1] === 'number') {
    out.push([value[0], value[1]]);
  } else {
    for (const child of value) collectPositions(child, out);
  }
  return out;
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-10 && x >= Math.min(xi, xj) - 1e-10 && x <= Math.max(xi, xj) + 1e-10 && y >= Math.min(yi, yj) - 1e-10 && y <= Math.max(yi, yj) + 1e-10) return true;
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!polygon.length || !pointInRing(point, polygon[0])) return false;
  for (const hole of polygon.slice(1)) if (pointInRing(point, hole)) return false;
  return true;
}

function pointInMunicipality(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => pointInPolygon(point, polygon));
}

function ringCentroid(ring) {
  let area6 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    area6 += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(area6) < 1e-12) {
    const points = ring.slice(0, -1);
    return points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length], [0, 0]);
  }
  return [cx / (3 * area6), cy / (3 * area6)];
}

function featureInMunicipality(feature, boundary) {
  const geometry = feature?.geometry;
  if (!geometry) return false;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    const outer = polygon?.[0];
    if (!outer?.length) continue;
    const center = ringCentroid(outer);
    if (pointInMunicipality(center, boundary) || pointInMunicipality(outer[0], boundary)) return true;
  }
  return false;
}

function ageAt(dateText) {
  const digits = String(dateText ?? '').replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1800) return null;
  const approved = new Date(Date.UTC(year, month - 1, day));
  if (approved.getUTCFullYear() !== year || approved.getUTCMonth() !== month - 1 || approved.getUTCDate() !== day) return null;
  if (approved > analysisDate) return null;
  let age = analysisDate.getUTCFullYear() - year;
  if (analysisDate.getUTCMonth() < month - 1 || (analysisDate.getUTCMonth() === month - 1 && analysisDate.getUTCDate() < day)) age--;
  return age;
}

function groupLabel(age) {
  if (age >= 100) return '100년 이상';
  const low = Math.floor(age / 10) * 10;
  return `${low}–${low + 9}년`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function svgChart(rows, validCount) {
  const width = 920;
  const height = 460;
  const left = 92;
  const top = 54;
  const plotWidth = 780;
  const plotHeight = 315;
  const max = Math.max(1, ...rows.map((r) => r.count));
  const barGap = 12;
  const barWidth = (plotWidth - barGap * (rows.length - 1)) / rows.length;
  const bars = rows.map((row, index) => {
    const bh = (row.count / max) * plotHeight;
    const x = left + index * (barWidth + barGap);
    const y = top + plotHeight - bh;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${bh.toFixed(1)}" rx="4" fill="#1976d2"/><text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" class="value">${row.count.toLocaleString('ko-KR')}</text><text x="${(x + barWidth / 2).toFixed(1)}" y="${top + plotHeight + 24}" text-anchor="middle" class="label">${row.group.replace('년', '')}</text>`;
  }).join('\n');
  const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const y = top + plotHeight - fraction * plotHeight;
    const val = Math.round(max * fraction);
    return `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}" stroke="#e2e8f0"/><text x="${left - 12}" y="${y + 5}" text-anchor="end" class="tick">${val.toLocaleString('ko-KR')}</text>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>text{font-family:'Malgun Gothic','Noto Sans KR',sans-serif;fill:#263238}.title{font-size:22px;font-weight:700}.subtitle{font-size:13px;fill:#64748b}.label{font-size:11px}.value{font-size:11px;font-weight:600}.tick{font-size:11px;fill:#64748b}</style>
  <rect width="100%" height="100%" fill="#fff"/><text x="${left}" y="28" class="title">삼척시 건물 노후도</text>
  <text x="${left}" y="46" class="subtitle">사용승인일 기준 · 2026-11-04 현재 · 유효 승인일 ${validCount.toLocaleString('ko-KR')}건</text>
  ${grid}<line x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}" stroke="#94a3b8"/>
  ${bars}<text x="${left + plotWidth / 2}" y="${height - 20}" text-anchor="middle" class="subtitle">사용승인 후 경과연수</text>
</svg>`;
}

await fs.mkdir(rawDir, { recursive: true });
await fs.mkdir(processedDir, { recursive: true });
await fs.mkdir(reportDir, { recursive: true });
const key = readKey(await fs.readFile(path.join(rootDir, '.env'), 'utf8'));

// Fetch the official administrative boundary, then use its exact polygon to retain Samcheok features.
const boundaryFeatures = await requestData(key, {
  data: 'LT_C_ADSIGG_INFO', bbox: [128.7, 36.9, 129.6, 37.8], page: 1, size: 100,
});
const boundaryFeature = boundaryFeatures.find((feature) => String(feature.properties?.sig_cd) === cityCode);
if (!boundaryFeature?.geometry) throw new Error('브이월드에서 삼척시 행정경계를 찾지 못했습니다.');
const boundaryPoints = collectPositions(boundaryFeature.geometry.coordinates);
const bbox = [
  Math.min(...boundaryPoints.map((p) => p[0])), Math.min(...boundaryPoints.map((p) => p[1])),
  Math.max(...boundaryPoints.map((p) => p[0])), Math.max(...boundaryPoints.map((p) => p[1])),
];
console.log(`삼척시 경계 확인: ${boundaryPoints.length.toLocaleString('ko-KR')}개 좌표점, 건물 조회 시작`);

const selected = [];
let fetched = 0;
for (let page = 1; page <= 500; page++) {
  const pageFeatures = await requestData(key, { data: 'LT_C_BLDGINFO', bbox, page, size: pageSize });
  fetched += pageFeatures.length;
  for (const feature of pageFeatures) {
    if (featureInMunicipality(feature, boundaryFeature.geometry)) selected.push(feature);
  }
  console.log(`페이지 ${page}: ${pageFeatures.length.toLocaleString('ko-KR')}건 수신, 삼척시 누적 ${selected.length.toLocaleString('ko-KR')}건`);
  if (pageFeatures.length < pageSize) break;
  if (page === 500) throw new Error('500페이지를 초과했습니다. API 페이징 한도 확인이 필요합니다.');
  await new Promise((resolve) => setTimeout(resolve, 150));
}
if (!selected.length) throw new Error('삼척시 건물을 찾지 못했습니다. API의 위치 필터와 좌표계를 확인해야 합니다.');

const geojson = { type: 'FeatureCollection', name: 'Samcheok_GIS_Building_Integration', crs: { type: 'name', properties: { name: 'EPSG:4326' } }, features: selected };
const geojsonPath = path.join(rawDir, 'samcheok_gis_buildings.geojson');
await fs.writeFile(geojsonPath, JSON.stringify(geojson), 'utf8');

const groups = new Map();
for (let lower = 0; lower < 100; lower += 10) groups.set(`${lower}–${lower + 9}년`, { group: `${lower}–${lower + 9}년`, count: 0 });
groups.set('100년 이상', { group: '100년 이상', count: 0 });
let missingApproval = 0;
let futureApproval = 0;
const ages = [];
const cohorts = new Map();
for (const feature of selected) {
  const rawDate = String(feature.properties?.useapr_day ?? '');
  const age = ageAt(rawDate);
  if (age === null) {
    const digits = rawDate.replace(/\D/g, '');
    const parsed = digits.length === 8 ? new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00Z`) : null;
    if (parsed && !Number.isNaN(parsed.getTime()) && parsed > analysisDate) futureApproval++;
    else missingApproval++;
    continue;
  }
  ages.push(age);
  groups.get(groupLabel(age)).count++;
  const year = Number(rawDate.replace(/\D/g, '').slice(0, 4));
  const decade = `${Math.floor(year / 10) * 10}년대`;
  cohorts.set(decade, (cohorts.get(decade) || 0) + 1);
}
const validCount = ages.length;
if (!validCount) throw new Error('삼척시 건물의 유효한 사용승인일이 없습니다.');
const rows = [...groups.values()];
for (const row of rows) {
  row.percent_valid = (row.count / validCount) * 100;
  row.percent_all = (row.count / selected.length) * 100;
}
const medianAge = [...ages].sort((a, b) => a - b)[Math.floor((ages.length - 1) / 2)];
const meanAge = ages.reduce((sum, age) => sum + age, 0) / validCount;
const older30 = ages.filter((age) => age >= 30).length;
const older40 = ages.filter((age) => age >= 40).length;
const csvHeader = ['연령구간', '건물수', '유효 승인일 기준 비율(%)', '전체 건물 기준 비율(%)'];
const csvRows = rows.map((row) => [row.group, row.count, row.percent_valid.toFixed(2), row.percent_all.toFixed(2)]);
await fs.writeFile(path.join(reportDir, 'age_distribution.csv'), '\uFEFF' + [csvHeader, ...csvRows].map((row) => row.map(csvCell).join(',')).join('\r\n'), 'utf8');
await fs.writeFile(path.join(reportDir, 'age_distribution.svg'), svgChart(rows, validCount), 'utf8');

const cohortRows = [...cohorts.entries()].sort((a, b) => Number(a[0].slice(0, 4)) - Number(b[0].slice(0, 4)));
const table = rows.map((row) => `| ${row.group} | ${row.count.toLocaleString('ko-KR')} | ${row.percent_valid.toFixed(1)}% | ${row.percent_all.toFixed(1)}% |`).join('\n');
const top = [...rows].sort((a, b) => b.count - a.count)[0];
const report = `# 삼척시 건물 노후도 분석\n\n- 분석 기준일: 2026-11-04\n- 자료: 브이월드 GIS건물통합정보 API, 행정구역코드 ${cityCode} (삼척시)\n- API 수신 건수: ${fetched.toLocaleString('ko-KR')}건 (삼척시 경계 내부 건물 ${selected.length.toLocaleString('ko-KR')}건)\n- 사용승인일 유효: ${validCount.toLocaleString('ko-KR')}건 / ${selected.length.toLocaleString('ko-KR')}건 (${(validCount / selected.length * 100).toFixed(1)}%)\n- 사용승인일 누락·형식오류: ${missingApproval.toLocaleString('ko-KR')}건\n- 기준일 이후 승인일: ${futureApproval.toLocaleString('ko-KR')}건\n- 유효 승인일 기준 평균 경과연수: ${meanAge.toFixed(1)}년; 중앙값: ${medianAge}년\n\n## 사용승인 후 경과연수\n\n| 경과연수 | 건물 수 | 유효 승인일 기준 비율 | 전체 건물 기준 비율 |\n|---|---:|---:|---:|\n${table}\n\n가장 큰 연령대는 **${top.group}**로 ${top.count.toLocaleString('ko-KR')}건(${top.percent_valid.toFixed(1)}%)입니다. 승인일을 확인할 수 있는 건물 중 30년 이상은 ${older30.toLocaleString('ko-KR')}건(${(older30 / validCount * 100).toFixed(1)}%), 40년 이상은 ${older40.toLocaleString('ko-KR')}건(${(older40 / validCount * 100).toFixed(1)}%)입니다.\n\n## 사용승인 연도대별 건물 수\n\n${cohortRows.map(([decade, count]) => `- ${decade}: ${count.toLocaleString('ko-KR')}건`).join('\n')}\n\n## 해석 기준\n\n연령은 사용승인일로부터 분석 기준일까지 경과한 만 나이(년)로 계산했습니다. 예를 들어 0–9년은 승인 후 10주년 전까지를 뜻합니다. 승인일 누락·오류 건은 연령 구간 비율의 분모에서 제외하고, 전체 건물 기준 비율도 함께 제시했습니다. 행정경계와 건물 도형의 중심점을 이용해 삼척시 자료를 선별했습니다.\n\n## 산출물\n\n- ../data/raw/samcheok_gis_buildings.geojson: 삼척시 건물 도형과 속성\n- age_distribution.csv: 연령대별 집계표\n- age_distribution.svg: 연령대 막대그래프\n`;
await fs.writeFile(path.join(reportDir, 'building_age_analysis.md'), report, 'utf8');
console.log(`완료: 삼척시 ${selected.length.toLocaleString('ko-KR')}건, 승인일 유효 ${validCount.toLocaleString('ko-KR')}건`);
console.log(`보고서: ${path.join(reportDir, 'building_age_analysis.md')}`);
