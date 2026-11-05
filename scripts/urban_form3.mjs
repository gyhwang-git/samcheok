// 도시형태3: 사용자가 제시한 축소 시기 구분(1기 1963-1988 탄광 활황기, 2기 1989-2004 급속 축소기, 3기 2005-현재 정체·도심 집중기)에
// '도시형태'(박훈 2020) 탭과 '도시형태2'(3기 세분) 탭의 정보를 종합해 시 전역(도계·삼척 시가지 양핵)을 단계별로 그린다.
// 시기 서술·인구 수치: 사용자 제공 자료(삼척시·삼척군 통계연보, 행정안전부 주민등록인구통계 2026.6) 그대로.
// 건물 변화: 현존 건물 사용승인일(현존 건물 기준이라 멸실 건물은 빠짐).

import { contours, chaikin, simplify, ringArea, classifyPlan, PLAN_CLASSES } from './potato_plan.mjs';
import { ageFor } from './building_use.mjs';
import { FORM_BBOX } from './urban_form.mjs';

export const FORM3_PERIODS = [
  { key: 'q1', label: '1기', range: '1963–1988', title: '탄광 활황기', start: 1963, end: 1988, color: '#1f5f86',
    pop: '13.9만 → 13.2만 명 (1981~1988)', space: '도계(탄광)와 삼척읍(행정·항만)의 양핵 구조' },
  { key: 'q2', label: '2기', range: '1989–2004', title: '급속 축소기', start: 1989, end: 2004, color: '#3a8bb0',
    pop: '13.1만 → 7.5만 명 (−43%)', space: '탄광 읍면 급감, 원도심(남양동) 인구 유출' },
  { key: 'q3', label: '3기', range: '2005–현재', title: '정체·도심 집중기', start: 2005, end: 9999, color: '#6aa8c9',
    pop: '7.4만 → 6.0만 명 (−18%)', space: '교동 신시가지로 집중, 읍면·원도심 동반 축소' },
];
export const FORM3_TIMELINE = {
  q1: [['1963', '소달면이 도계읍으로 승격'], ['1975', '석유파동기 석탄 증산, 도계읍 인구 정점 42,660명'], ['1981', '황지·장성읍이 태백시로 분리'], ['1986', '삼척읍이 삼척시로 승격']],
  q2: [['1989', '석탄산업 합리화 시행, 폐광 본격화'], ['1990~2000', '도계읍 인구 58% 감소 (35,086 → 14,693명)'], ['1995', '삼척시·삼척군 도농통합'], ['1998', '과소 행정동 통폐합 (6개 → 4개 동)']],
  q3: [['2007~2013', '인구 71,256명 저점 후 73,783명까지 일시 반등'], ['2005~2026', '교동 인구 55% 증가 (9,762 → 15,159명)'], ['2025', '대한석탄공사 도계광업소 폐광'], ['2026', '시내 4개 동에 인구 63% 거주']],
};
export const FORM3_SOURCE = '인구는 각 연도 행정구역 기준(1995년 이전은 삼척시·삼척군 합계, 1981년 이전은 태백 지역 포함으로 제외). 2026년은 6월 기준. 출처: 삼척시·삼척군 통계연보, 행정안전부 주민등록인구통계(2026년 6월)';

const HOUSING = new Set(['01000', '02000']);
const INDUSTRY = new Set(['17000', '18000', '19000', '20000', '25000']);
const ANCHORS = {
  dogye: /^도계읍사무소$/, dogyeMine: /대한석탄공사 도계광업소/, cityhall: /^삼척시청사?$/, jukseoru: /^죽서루$/,
  seongnae: /성내동사무소/, namyang: /남양동사무소/, gyodongOffice: /교동사무소/, jeongna: /정라동사무소/,
  cement: /동양시멘트주식회사 삼척공장/, port: /삼척수산업협동조합/, market: /^중앙시장$/,
};
const centroid = (f) => { const g = f.geometry; if (!g) return null; const r = (g.type === 'Polygon' ? g.coordinates : g.coordinates[0])[0]; return [r.reduce((s, q) => s + q[0], 0) / r.length, r.reduce((s, q) => s + q[1], 0) / r.length]; };

export function computeUrbanForm3(features) {
  const pts = [], A = {};
  for (const f of features) {
    const p = f.properties ?? {}, c = centroid(f); if (!c) continue;
    const name = String(p.bld_nm ?? '');
    for (const [k, re] of Object.entries(ANCHORS)) if (!A[k] && re.test(name)) A[k] = c;
    pts.push({ lon: c[0], lat: c[1], year: ageFor(p.useapr_day) == null ? null : Number(String(p.useapr_day).slice(0, 4)), code: String(p.usability ?? '').trim(), floors: Number(p.grnd_flr) || 0, cls: classifyPlan(p), name });
  }
  const lon0 = Math.min(...pts.map((p) => p.lon)), lat0 = Math.min(...pts.map((p) => p.lat)), latM = (lat0 + Math.max(...pts.map((p) => p.lat))) / 2;
  const kx = Math.cos((latM * Math.PI) / 180) * 111320, ky = 110540;
  for (const p of pts) { p.x = (p.lon - lon0) * kx; p.y = (p.lat - lat0) * ky; }
  const dist = (p, a) => Math.hypot((p.lon - a[0]) * kx, (p.lat - a[1]) * ky);
  const [bx0, by0, bx1, by1] = FORM_BBOX;
  const region = (p) => (p.lon >= bx0 && p.lon <= bx1 && p.lat >= by0 && p.lat <= by1 ? 'city' : A.dogye && dist(p, A.dogye) <= 4000 ? 'dogye' : 'other');

  // 시 전역 밀도 윤곽 (60m 격자, σ=120m)
  const CELL = 60, SIG = 120, PAD = 600;
  const W = Math.ceil((Math.max(...pts.map((p) => p.x)) + PAD * 2) / CELL), H = Math.ceil((Math.max(...pts.map((p) => p.y)) + PAD * 2) / CELL);
  const R = Math.ceil(SIG * 3 / CELL), ker = [];
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const d2 = (di * CELL) ** 2 + (dj * CELL) ** 2; if (d2 <= (SIG * 3) ** 2) ker.push([di, dj, (10000 / (2 * Math.PI * SIG * SIG)) * Math.exp(-d2 / (2 * SIG * SIG))]); }
  const toLL = (gx, gy) => [Number((lon0 + (gx * CELL - PAD) / kx).toFixed(5)), Number((lat0 + (gy * CELL - PAD) / ky).toFixed(5))];
  function blob(sub, t, minHa) {
    if (!sub.length) return [];
    const v = new Float32Array(W * H);
    for (const p of sub) { const ci = Math.round((p.x + PAD) / CELL), cj = Math.round((p.y + PAD) / CELL); for (const [di, dj, w] of ker) { const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < W && j < H) v[j * W + i] += w; } }
    return contours(v, W, H, t).map((r) => chaikin(simplify(r, 0.5), 3)).filter((r) => ringArea(r) * CELL * CELL / 10000 >= minHa).map((r) => r.map((q) => toLL(q[0], q[1])));
  }
  const kind = (p) => (HOUSING.has(p.code) ? 'housing' : INDUSTRY.has(p.code) ? 'industry' : null);

  const gyApts = A.gyodongOffice ? pts.filter((p) => p.code === '02000' && p.floors >= 5 && p.year >= 1995 && p.lon >= A.gyodongOffice[0] && p.lat >= A.gyodongOffice[1] - 0.0015 && dist(p, A.gyodongOffice) <= 1300) : [];
  const gyAt = gyApts.length ? [gyApts.reduce((s, p) => s + p.lon, 0) / gyApts.length, gyApts.reduce((s, p) => s + p.lat, 0) / gyApts.length] : A.gyodongOffice;
  const north = A.seongnae && A.jukseoru ? [A.seongnae[0] + (A.seongnae[0] - A.jukseoru[0]) * 1.2, A.seongnae[1] + (A.seongnae[1] - A.jukseoru[1]) * 1.2] : null;
  const mid = (a, b) => (a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null);

  // 단계별 지도 주석: 사용자 자료(시기 표) + 도시형태(박훈 2020) + 도시형태2(3기 세분)를 종합. src: user | paper | data
  const notes = {
    q1: [
      { kind: 'core', at: A.dogye, r: 2600, title: '도계 — 탄광 핵', text: '1963년 소달면이 도계읍으로 승격. 1975년 석유파동기 석탄 증산으로 도계읍 인구 정점 42,660명.', src: 'user', ref: '1963 · 1975' },
      { kind: 'core', at: mid(A.cityhall, A.jukseoru) ?? A.cityhall, r: 2200, title: '삼척읍 — 행정·항만 핵', text: '1986년 삼척읍이 삼척시로 승격. 남산 절단·오십천 개조(1962–1970)로 남양동 신시가지 택지 확보, 정라항→삼척항(1966) 축항.', src: 'user+paper', ref: '1986 · 박훈 4.2' },
      { kind: 'link', from: A.dogye, to: A.cityhall, title: '양핵 구조', text: '도계(탄광)와 삼척읍(행정·항만)의 두 중심이 영동선 철도로 연결.', src: 'user', ref: '1기 공간' },
      { kind: 'marker', at: A.cement, title: '동양시멘트 증설', text: '오노다시멘트(1942) → 동양시멘트(1957). 1959·1961·1967·1975년 증설로 항만·산업 기반 형성.', src: 'paper', ref: '박훈 4.1·Table 3' },
      { kind: 'edge', at: A.dogye, dir: [-1, 0.05], len: 9000, title: '1981 황지·장성읍 태백시 분리', text: '탄광 지역 일부가 태백시로 분리(1981). 이후 인구는 현 행정구역 기준.', src: 'user', ref: '1981' },
    ],
    q2: [
      { kind: 'shrink', at: A.dogye, r: 2600, title: '도계 — 폐광·급감', text: '1989년 석탄산업 합리화로 폐광 본격화. 1990~2000년 도계읍 인구 58% 감소(35,086 → 14,693명).', src: 'user', ref: '1989 · 1990~2000' },
      { kind: 'area', key: 'gy95', at: gyAt, title: '교동 택지개발(1995–1998)', text: '공동주택 단지 중심 택지. 구릉 지형을 따라 조성.', src: 'paper', ref: '박훈 4.3' },
      { kind: 'arrow', from: A.namyang, to: gyAt, title: '원도심(남양동) 인구 유출', text: '원도심에서 교동 신시가지 쪽으로 인구 이동이 시작.', src: 'user+paper', ref: '2기 공간 · 박훈 4.3' },
      { kind: 'marker', at: A.cityhall, title: '1995 도농통합 · 1998 행정동 통폐합', text: '삼척시·삼척군 통합(1995). 과소 행정동 6개 → 4개 동(1998).', src: 'user', ref: '1995 · 1998' },
      { kind: 'axis', path: [A.jukseoru, A.seongnae, north].filter(Boolean), title: '대학로 상권', text: '1980년대 조성된 대학로에 상권 형성.', src: 'paper', ref: '박훈 6장', approx: true },
    ],
    q3: [
      { kind: 'grow', at: gyAt, r: 900, title: '교동 신시가지 — 집중', text: '2005~2026년 교동 인구 55% 증가(9,762 → 15,159명). 교동 택지가 중심 기능을 하게 됨.', src: 'user+paper', ref: '2005~2026 · 박훈 4.3' },
      { kind: 'shrink', at: A.market, r: 600, title: '원도심 동반 축소', text: '중앙시장 일대 등 기존 중심 시가지 일부 공동화.', src: 'paper+user', ref: '박훈 4.3 · 3기 공간' },
      { kind: 'marker', at: A.dogyeMine, title: '2025 도계광업소 폐광', text: '대한석탄공사 도계광업소 폐광(2025).', src: 'user', ref: '2025' },
      { kind: 'ring', at: A.cityhall, title: '시내 4개 동 63% 거주(2026)', text: '교동·남양동·성내동·정라동에 시 인구의 63% 거주(2026년 6월).', src: 'user', ref: '2026' },
      { kind: 'shrink', at: A.dogye, r: 2600, title: '읍면 축소 지속', text: '읍면 지역은 원도심과 함께 축소.', src: 'user', ref: '3기 공간' },
    ],
  };
  for (const k in notes) notes[k] = notes[k].filter((n) => (n.at || n.from || n.path?.length) && (n.kind !== 'link' && n.kind !== 'arrow' || (n.from && n.to)));

  const periods = {};
  for (const P of FORM3_PERIODS) {
    const cum = pts.filter((p) => p.year != null && p.year <= P.end), inP = pts.filter((p) => p.year != null && p.year >= P.start && p.year <= P.end);
    const reg = { city: 0, dogye: 0, other: 0 }; for (const p of inP) reg[region(p)]++;
    const mix = PLAN_CLASSES.map(() => 0); for (const p of inP) if (p.cls >= 0) mix[p.cls]++;
    periods[P.key] = {
      housing: blob(cum.filter((p) => kind(p) === 'housing'), 1.3, 1.5),
      industry: blob(cum.filter((p) => kind(p) === 'industry'), 0.45, 1),
      newArea: blob(inP.filter((p) => kind(p)), 1.1, 1.5),
      n: inP.length, cumN: cum.length, reg, mix, five: inP.filter((p) => p.floors >= 5).length,
    };
  }
  periods.q2.gy95 = blob(gyApts.filter((p) => p.year <= 2004), 0.3, 0.5);
  return { meta: FORM3_PERIODS, timeline: FORM3_TIMELINE, source: FORM3_SOURCE, periods, notes, anchors: A, cityBox: FORM_BBOX, gyN: gyApts.length };
}
