import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(projectDir, 'data', 'raw', 'samcheok_gis_buildings.geojson');
const reportDir = path.join(projectDir, 'reports');
const analysisDate = new Date('2026-11-04T00:00:00Z');
const fc = JSON.parse(await fs.readFile(input, 'utf8'));

function approvalAge(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 8) return { age: null, future: false };
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1800) return { age: null, future: false };
  const date = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10).replaceAll('-', '') !== digits) return { age: null, future: false };
  if (date > analysisDate) return { age: null, future: true };
  let age = analysisDate.getUTCFullYear() - year;
  if (analysisDate.getUTCMonth() < month - 1 || (analysisDate.getUTCMonth() === month - 1 && analysisDate.getUTCDate() < day)) age--;
  return { age, future: false };
}

function label(age) {
  if (age >= 100) return '100년 이상';
  const start = Math.floor(age / 10) * 10;
  return `${start}–${start + 9}년`;
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const groups = new Map();
for (let age = 0; age < 100; age += 10) groups.set(`${age}–${age + 9}년`, { group: `${age}–${age + 9}년`, count: 0 });
groups.set('100년 이상', { group: '100년 이상', count: 0 });
const cohorts = new Map();
const ages = [];
let missing = 0;
let future = 0;
for (const feature of fc.features) {
  const raw = String(feature.properties?.useapr_day ?? '');
  const result = approvalAge(raw);
  if (result.age === null) {
    if (result.future) future++;
    else missing++;
    continue;
  }
  ages.push(result.age);
  groups.get(label(result.age)).count++;
  const year = Number(raw.replace(/\D/g, '').slice(0, 4));
  const decade = `${Math.floor(year / 10) * 10}년대`;
  cohorts.set(decade, (cohorts.get(decade) || 0) + 1);
}
if (!ages.length) throw new Error('유효한 사용승인일이 없습니다.');
const validCount = ages.length;
const rows = [...groups.values()];
for (const row of rows) {
  row.percent_valid = row.count / validCount * 100;
  row.percent_all = row.count / fc.features.length * 100;
}
const sortedAges = [...ages].sort((a, b) => a - b);
const median = sortedAges[Math.floor((sortedAges.length - 1) / 2)];
const mean = ages.reduce((sum, value) => sum + value, 0) / validCount;
const count30 = ages.filter((age) => age >= 30).length;
const count40 = ages.filter((age) => age >= 40).length;
const top = [...rows].sort((a, b) => b.count - a.count)[0];

const svgWidth = 920;
const svgHeight = 460;
const left = 92;
const topY = 54;
const plotWidth = 780;
const plotHeight = 315;
const max = Math.max(1, ...rows.map((row) => row.count));
const gap = 12;
const barWidth = (plotWidth - gap * (rows.length - 1)) / rows.length;
const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
  const y = topY + plotHeight - f * plotHeight;
  return `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}" stroke="#e2e8f0"/><text x="${left - 12}" y="${y + 5}" text-anchor="end" class="tick">${Math.round(max * f).toLocaleString('ko-KR')}</text>`;
}).join('\n');
const bars = rows.map((row, i) => {
  const height = row.count / max * plotHeight;
  const x = left + i * (barWidth + gap);
  const y = topY + plotHeight - height;
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" rx="4" fill="#1976d2"/><text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" class="value">${row.count.toLocaleString('ko-KR')}</text><text x="${(x + barWidth / 2).toFixed(1)}" y="${topY + plotHeight + 24}" text-anchor="middle" class="label">${row.group.replace('년', '')}</text>`;
}).join('\n');
const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}"><style>text{font-family:'Malgun Gothic','Noto Sans KR',sans-serif;fill:#263238}.title{font-size:22px;font-weight:700}.subtitle{font-size:13px;fill:#64748b}.label{font-size:11px}.value{font-size:11px;font-weight:600}.tick{font-size:11px;fill:#64748b}</style><rect width="100%" height="100%" fill="#fff"/><text x="${left}" y="28" class="title">삼척시 건물 노후도</text><text x="${left}" y="46" class="subtitle">사용승인일 기준 · 2026-11-04 현재 · 유효 승인일 ${validCount.toLocaleString('ko-KR')}건</text>${grid}<line x1="${left}" y1="${topY + plotHeight}" x2="${left + plotWidth}" y2="${topY + plotHeight}" stroke="#94a3b8"/>${bars}<text x="${left + plotWidth / 2}" y="${svgHeight - 20}" text-anchor="middle" class="subtitle">사용승인 후 경과연수</text></svg>`;

const csvHeader = ['연령구간', '건물수', '유효 승인일 기준 비율(%)', '전체 건물 기준 비율(%)'];
const csvRows = rows.map((row) => [row.group, row.count, row.percent_valid.toFixed(2), row.percent_all.toFixed(2)]);
await fs.mkdir(reportDir, { recursive: true });
await fs.writeFile(path.join(reportDir, 'age_distribution.csv'), '\uFEFF' + [csvHeader, ...csvRows].map((row) => row.map(csvCell).join(',')).join('\r\n'), 'utf8');
await fs.writeFile(path.join(reportDir, 'age_distribution.svg'), svg, 'utf8');

const cohortRows = [...cohorts.entries()].sort((a, b) => Number(a[0].slice(0, 4)) - Number(b[0].slice(0, 4)));
const table = rows.map((row) => `| ${row.group} | ${row.count.toLocaleString('ko-KR')} | ${row.percent_valid.toFixed(1)}% | ${row.percent_all.toFixed(1)}% |`).join('\n');
const report = `# 삼척시 건물 노후도 분석\n\n- 분석 기준일: 2026-11-04\n- Source: https://www.data.go.kr/catalog/15083092/fileData.json\n- License: CC BY; attribution required\n- 자료: 브이월드 GIS건물통합정보 API (LT_C_BLDGINFO), 행정구역코드 51230 (삼척시)\n- 삼척시 경계 내부 건물: ${fc.features.length.toLocaleString('ko-KR')}건\n- 사용승인일 유효: ${validCount.toLocaleString('ko-KR')}건 / ${fc.features.length.toLocaleString('ko-KR')}건 (${(validCount / fc.features.length * 100).toFixed(1)}%)\n- 사용승인일 누락·형식 오류·1800년 이전 이상값: ${missing.toLocaleString('ko-KR')}건\n- 기준일 이후 승인일: ${future.toLocaleString('ko-KR')}건\n- 유효 승인일 기준 평균 경과연수: ${mean.toFixed(1)}년; 중앙값: ${median}년\n\n## 사용승인 후 경과연수\n\n| 경과연수 | 건물 수 | 유효 승인일 기준 비율 | 전체 건물 기준 비율 |\n|---|---:|---:|---:|\n${table}\n\n가장 큰 연령대는 **${top.group}**로 ${top.count.toLocaleString('ko-KR')}건(${top.percent_valid.toFixed(1)}%)입니다. 승인일을 확인할 수 있는 건물 중 30년 이상은 ${count30.toLocaleString('ko-KR')}건(${(count30 / validCount * 100).toFixed(1)}%), 40년 이상은 ${count40.toLocaleString('ko-KR')}건(${(count40 / validCount * 100).toFixed(1)}%)입니다.\n\n## 사용승인 연도대별 건물 수\n\n${cohortRows.map(([decade, count]) => `- ${decade}: ${count.toLocaleString('ko-KR')}건`).join('\n')}\n\n## 해석 기준과 데이터 한계\n\n연령은 사용승인일로부터 분석 기준일까지 경과한 만 나이(년)로 계산했습니다. 예를 들어 0–9년은 승인 후 10주년 전까지입니다. 승인일이 누락되거나 형식이 잘못된 건, 1800년 이전 이상값은 연령 구간 비율의 분모에서 제외했습니다. 유효 승인일은 전체 건물의 ${(validCount / fc.features.length * 100).toFixed(1)}%이므로, 연령대 비율은 승인일이 확인되는 건물을 기준으로 해석해야 합니다.\n\n행정경계와 건물 도형의 중심점으로 삼척시 자료를 선별했습니다.\n\n## 산출물\n\n- data/raw/samcheok_gis_buildings.geojson: 삼척시 건물 도형과 API 속성\n- data/processed/samcheok_gis_buildings.shp (+ .shx, .dbf, .prj, .cpg): GIS에서 열 수 있는 SHP 파일\n- age_distribution.csv: 연령대별 집계표\n- age_distribution.svg: 연령대 막대그래프\n`;
await fs.writeFile(path.join(reportDir, 'building_age_analysis.md'), report, 'utf8');
console.log(`분석 보고서 갱신: ${validCount.toLocaleString('ko-KR')}건의 유효 승인일, 누락/이상 ${missing.toLocaleString('ko-KR')}건`);
