// 건물 용도·사용승인 연도 기반 감자도(potato plan).
// 칸마다 우세 용도 하나만 배정해 권역이 겹치지 않게 하고, 밀도 정점별로 나눈 아메바형 덩어리를 흰 틈으로 분리한다.
// 임계 밀도는 시기와 무관하게 고정해 권역의 확장·출현을 비교한다.

import { ageFor } from './building_use.mjs';

// 계획 용도군. 색은 사용자가 제시한 도시구조도 참고 이미지의 톤(주거 분홍베이지~자주, 상업 산호, 공업 청회색, 교육 청록, 공공기관 강청색, 농축산 세이지).
// threshold: 권역으로 볼 최소 밀도(건/ha, σ=220m 커널). 건물 하나의 정점 밀도는 약 0.033건/ha.
export const PLAN_CLASSES = [
  { key: 'det', label: '저밀주거지', color: '#cfaea6', threshold: 0.9, desc: '단독주택(01000)' },
  { key: 'row', label: '다세대·연립', color: '#b9878d', threshold: 0.1, desc: '공동주택(02000) 중 지상 4층 이하' },
  { key: 'apt', label: '고밀주거지', color: '#9b5f7c', threshold: 0.1, desc: '아파트: 공동주택(02000) 중 지상 5층 이상(층수 미상이면 건물명에 아파트·APT)' },
  { key: 'com', label: '상업', color: '#e3705f', threshold: 0.3, desc: '근린생활·판매·운수·업무·숙박·위락시설(공공기관 제외)' },
  { key: 'ind', label: '공업', color: '#7d82a6', threshold: 0.16, desc: '공장·창고·위험물·자동차관련·발전시설' },
  { key: 'edu', label: '교육시설', color: '#4fc1c4', threshold: 0.12, desc: '교육연구시설(10000)과 학교명이 확인된 구 코드 Z8000' },
  { key: 'gov', label: '공공기관', color: '#3f7fa8', threshold: 0.025, desc: '건물명이 관공서(시청·읍면동사무소·행정복지센터·경찰서·파출소·지구대·소방서·우체국·보건소·세무서·등기소·교육청·출장소 등)인 건물과 교정및군사시설' },
  { key: 'agr', label: '농축산', color: '#9fc28f', threshold: 0.14, desc: '동물및식물관련시설' },
];
const IDX = Object.fromEntries(PLAN_CLASSES.map((c, i) => [c.key, i]));
export const CENTER_KEYS = ['com', 'gov']; // 중심지 = 상업+공공기관 밀도 정점

// 관공서 건물명 키워드 (코드만으로는 공공업무시설을 구분할 수 없어 이름으로 판별)
const GOV_RE = /(시청|청사|읍사무소|면사무소|동사무소|행정복지센터|주민센터|경찰서|파출소|지구대|치안센터|소방서|119|안전센터|의용소방대|우체국|보건소|보건지소|보건진료소|보건출장소|세무서|법원|등기소|교육청|교육지원청|출장소|통계청|농업기술센터|건강보험공단|국민연금|고용센터|농관원)/;
const COM = new Set(['03000', '04000', '07000', '08000', '14000', '15000', '16000']);
const IND = new Set(['17000', '18000', '19000', '20000', '25000']);

// 건물 속성 → 계획 용도군 인덱스(-1 = 감자도에서 제외)
export function classifyPlan(p) {
  const code = String(p?.usability ?? '').trim(), name = String(p?.bld_nm ?? ''), fl = Number(p?.grnd_flr) || 0;
  if (!code) return -1;
  if (code === '23000' || (GOV_RE.test(name) && !/주유소|관사|앞/.test(name))) return IDX.gov;
  if (code === '10000' || code === 'Z8000') return IDX.edu;
  if (code === '01000') return IDX.det;
  if (code === '02000') return fl >= 5 || (!fl && /아파트|APT/i.test(name)) ? IDX.apt : IDX.row;
  if (COM.has(code)) return IDX.com;
  if (IND.has(code)) return IDX.ind;
  if (code === '21000') return IDX.agr;
  return -1;
}

// 시기 구분(사용승인 연도). end 는 그 시기 마지막 연도.
export const ERAS = [
  { key: 'e1979', label: '~1979', start: 0, end: 1979 },
  { key: 'e1980', label: '1980년대', start: 1980, end: 1989 },
  { key: 'e1990', label: '1990년대', start: 1990, end: 1999 },
  { key: 'e2000', label: '2000년대', start: 2000, end: 2009 },
  { key: 'e2010', label: '2010년대', start: 2010, end: 2019 },
  { key: 'e2020', label: '2020~', start: 2020, end: 9999 },
];

const CELL = 100; // m
const SIGMA = 220; // m
const MIN_AREA_HA = 2;
const SEED_R = 9; // 생활권 덩어리 씨앗 간 최소 간격(칸) ≈ 900m
const GAP_LEVEL = 0.52; // 서로 겹치지 않는 마스크를 흐린 뒤 0.5 이상에서 경계를 따므로 이웃 권역이 겹치지 않음
const BLUR_PASSES = 3; // 클수록 경계가 둥글어짐(대신 가는 돌출부가 사라짐)
// 겹치는 칸의 우세 용도 판정 점수 = 밀도 / 임계값^DOMINANCE_EXP (1이면 임계 대비 비율, 0이면 절대 밀도)
const DOMINANCE_EXP = 0.75; // 1이면 희소 용도(학교·관공서)가 단독주택 권역을 잠식, 0.5 이하면 아파트가 사라짐
// 공간구조도: 더 넓은 커널·강한 흐림으로 권역을 일반화하고, 중심지 위계·개발축·확산 방향을 덧그린다.
const STRUCT_SIGMA = 450; // m
const STRUCT_SCALE = 1; // 감자도와 같은 임계 밀도
const STRUCT_ZONE_SIGMA = 150; // m — 권역은 좁은 커널로 실제 시가지 윤곽(골짜기·도로를 따라 뻗은 가지)을 살림
const STRUCT_CATCH_M = 2500; // 중심지 세력권 반경
const NEW_SCALE = 0.5; // 신축(한 시기) 장면은 건물이 적어 임계 밀도를 절반으로 낮춘다

// 닫힌 링 더글러스-포이커 단순화(격자 계단 제거 후 곡선화)
function simplify(ring, tol) {
  if (ring.length < 8) return ring;
  const keep = new Uint8Array(ring.length); keep[0] = 1;
  let far = 0, fd = -1; for (let i = 1; i < ring.length; i++) { const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  keep[far] = 1;
  const stack = [[0, far], [far, ring.length]];
  while (stack.length) {
    const [a, b] = stack.pop(); const A = ring[a], B = ring[b % ring.length];
    let idx = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const P = ring[i]; const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-9; const d = Math.abs(dy * P[0] - dx * P[1] + B[0] * A[1] - B[1] * A[0]) / L; if (d > md) { md = d; idx = i; } }
    if (idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}

function chaikin(ring, iterations = 2) {
  let pts = ring;
  for (let k = 0; k < iterations; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}

const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
function inside(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// 마칭 스퀘어: 격자값 v(nx*ny, 행 우선)에서 임계값 t 의 닫힌 등치선(격자 좌표)
function contours(v, nx, ny, t) {
  const at = (i, j) => v[j * nx + i];
  const pts = new Map();
  const point = (id) => {
    if (pts.has(id)) return id;
    const [kind, i, j] = id;
    let p;
    if (kind === 'h') { const a = at(i, j), b = at(i + 1, j); p = [i + (t - a) / (b - a), j]; } else { const a = at(i, j), b = at(i, j + 1); p = [i, j + (t - a) / (b - a)]; }
    pts.set(id, p);
    return id;
  };
  const adj = new Map();
  const link = (e1, e2) => {
    for (const [a, b] of [[e1, e2], [e2, e1]]) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); }
  };
  const keyOf = (k, i, j) => k + i + ',' + j;
  const edgeCoords = new Map();
  const E = (k, i, j) => { const key = keyOf(k, i, j); if (!edgeCoords.has(key)) edgeCoords.set(key, point([k, i, j])); return key; };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const tl = at(i, j) >= t, tr = at(i + 1, j) >= t, br = at(i + 1, j + 1) >= t, bl = at(i, j + 1) >= t;
      const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const top = () => E('h', i, j), right = () => E('v', i + 1, j), bottom = () => E('h', i, j + 1), left = () => E('v', i, j);
      const center = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 >= t;
      switch (c) {
        case 1: case 14: link(left(), bottom()); break;
        case 2: case 13: link(bottom(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(left(), top()); break;
        case 5: if (center) { link(left(), top()); link(bottom(), right()); } else { link(top(), right()); link(left(), bottom()); } break;
        case 10: if (center) { link(top(), right()); link(left(), bottom()); } else { link(left(), top()); link(bottom(), right()); } break;
      }
    }
  }
  const coordOf = (key) => pts.get(edgeCoords.get(key));
  const seen = new Set();
  const rings = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const ring = [];
    let prev = null, cur = start;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      ring.push(coordOf(cur));
      const nb = adj.get(cur);
      const next = nb.find((n) => n !== prev && !seen.has(n)) ?? null;
      prev = cur;
      cur = next;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// points: [{ lon, lat, cls, year }] (year 없으면 null)
export function computePotato(points) {
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lon0 = points.reduce((s, p) => s + p.lon, 0) / points.length;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110540;
  const P = points.map((p) => ({ ...p, x: (p.lon - lon0) * kx, y: (p.lat - lat0) * ky }));
  const pad = Math.max(SIGMA, STRUCT_SIGMA) * 4;
  const x0 = Math.min(...P.map((p) => p.x)) - pad, y0 = Math.min(...P.map((p) => p.y)) - pad;
  const nx = Math.ceil((Math.max(...P.map((p) => p.x)) + pad - x0) / CELL) + 1;
  const ny = Math.ceil((Math.max(...P.map((p) => p.y)) + pad - y0) / CELL) + 1;
  function makeKernel(sigma) {
    const R = Math.ceil((sigma * 3) / CELL), k = [];
    const norm = 10000 / (2 * Math.PI * sigma * sigma); // 건물/ha
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const d2 = (di * CELL) ** 2 + (dj * CELL) ** 2;
      if (d2 <= (sigma * 3) ** 2) k.push([di, dj, norm * Math.exp(-d2 / (2 * sigma * sigma))]);
    }
    return k;
  }
  const kernel = makeKernel(SIGMA);
  const toLonLatM = (x, y) => [Number((lon0 + x / kx).toFixed(5)), Number((lat0 + y / ky).toFixed(5))];
  const toLonLat = (gx, gy) => [Number((lon0 + (x0 + gx * CELL) / kx).toFixed(5)), Number((lat0 + (y0 + gy * CELL) / ky).toFixed(5))];

  function surface(pts, K = kernel) {
    const v = new Float32Array(nx * ny);
    for (const p of pts) {
      const ci = Math.round((p.x - x0) / CELL), cj = Math.round((p.y - y0) / CELL);
      for (const [di, dj, w] of K) v[(cj + dj) * nx + ci + di] += w;
    }
    return v;
  }
  const haOf = (r) => ringArea(r) * CELL * CELL / 10000;

  // 겹치지 않는 아메바형 감자도:
  // 1) 각 격자 칸을 '임계 대비 밀도 비(밀도/임계값)'가 가장 큰 용도 하나에만 배정(비 ≥ 1일 때)
  // 2) 같은 용도 안에서는 밀도 정점(씨앗)별로 가장 가까운 칸을 묶어 생활권 단위 덩어리로 분할
  // 3) 덩어리 마스크를 흐리게 한 뒤 0.5보다 높은 수준에서 경계를 따 서로 사이에 틈을 두고, 모서리를 둥글게 다듬음
  function tessellate(subset, scale, o = {}) {
    const K = o.kernel ?? kernel, seedR = o.seedR ?? SEED_R, blur = o.blur ?? BLUR_PASSES, minHa = o.minHa ?? MIN_AREA_HA;
    const ratios = PLAN_CLASSES.map((c, ci) => {
      const v = surface(subset.filter((p) => p.cls === ci), K);
      const t = c.threshold * scale * (o.thresholdScale?.[ci] ?? 1);
      for (let k = 0; k < v.length; k++) v[k] /= t;
      return v;
    });
    const WEIGHT = PLAN_CLASSES.map((c) => (c.threshold * scale) ** (1 - DOMINANCE_EXP)); // ratio×t^(1-e) = 밀도/t^e
    const cls = new Int8Array(nx * ny).fill(-1);
    for (let k = 0; k < cls.length; k++) {
      let best = -1, bv = 0;
      for (let c = 0; c < ratios.length; c++) { if (ratios[c][k] < 1) continue; const sc = ratios[c][k] * WEIGHT[c]; if (sc > bv) { bv = sc; best = c; } }
      cls[k] = best;
    }
    // 씨앗: 용도 영역 안의 국지 최댓값(반경 SEED_R 칸)
    const seeds = [];
    if (o.single) PLAN_CLASSES.forEach((_, c) => seeds.push({ c, i: 0, j: 0, id: c })); // 용도별 한 덩어리(같은 용도 사이 틈 없음)
    else
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i, c = cls[k];
      if (c < 0) continue;
      const v = ratios[c][k];
      let isMax = true;
      for (let dj = -seedR; dj <= seedR && isMax; dj++) for (let di = -seedR; di <= seedR; di++) {
        const ii = i + di, jj = j + dj;
        if ((!di && !dj) || ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const kk = jj * nx + ii;
        if (cls[kk] === c && (ratios[c][kk] > v || (ratios[c][kk] === v && kk < k))) { isMax = false; break; }
      }
      if (isMax) seeds.push({ c, i, j, id: seeds.length });
    }
    const seedsByClass = PLAN_CLASSES.map((_, c) => seeds.filter((s) => s.c === c));
    // 칸 → 같은 용도의 가장 가까운 씨앗
    const label = new Int32Array(nx * ny).fill(-1);
    const boxes = seeds.map(() => [Infinity, Infinity, -Infinity, -Infinity]);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, c = cls[k];
      if (c < 0) continue;
      let best = -1, bd = Infinity;
      for (const s of seedsByClass[c]) { const d = (s.i - i) ** 2 + (s.j - j) ** 2; if (d < bd) { bd = d; best = s; } }
      if (!best) continue;
      const id = best.id;
      label[k] = id;
      const b = boxes[id]; if (i < b[0]) b[0] = i; if (j < b[1]) b[1] = j; if (i > b[2]) b[2] = i; if (j > b[3]) b[3] = j;
    }
    const out = PLAN_CLASSES.map(() => ({ rings: [], labels: [], areaHa: 0 }));
    seeds.forEach((s, id) => {
      const [bi0, bj0, bi1, bj1] = boxes[id];
      if (!Number.isFinite(bi0)) return;
      const pd = 4 + blur * 2, i0 = bi0 - pd, j0 = bj0 - pd, w = bi1 - bi0 + 1 + pd * 2, h = bj1 - bj0 + 1 + pd * 2;
      let m = new Float32Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const gi = i0 + i, gj = j0 + j;
        if (gi >= 0 && gj >= 0 && gi < nx && gj < ny && label[gj * nx + gi] === id) m[j * w + i] = 1;
      }
      for (let pass = 0; pass < blur * 2; pass++) { // 5탭 이항 흐림, 가로·세로 분리 적용 (σ ≈ 1 칸/회)
        const n2 = new Float32Array(w * h), horiz = pass % 2 === 0;
        for (let j = 2; j < h - 2; j++) for (let i = 2; i < w - 2; i++) {
          const k = j * w + i, st = horiz ? 1 : w;
          n2[k] = (m[k - 2 * st] + 4 * m[k - st] + 6 * m[k] + 4 * m[k + st] + m[k + 2 * st]) / 16;
        }
        m = n2;
      }
      let rings = contours(m, w, h, GAP_LEVEL).map((r) => chaikin(simplify(r.map((q) => [q[0] + i0, q[1] + j0]), o.simplifyTol ?? 0.35), o.chaikin ?? 4)).filter((r) => haOf(r) >= minHa);
      rings = rings.filter((r, i) => !rings.some((o, k) => k !== i && ringArea(o) > ringArea(r) && inside(r[0], o)));
      for (const r of rings) {
        let sx = 0, sy = 0; for (const q of r) { sx += q[0]; sy += q[1]; }
        out[s.c].rings.push(r);
        out[s.c].labels.push({ at: toLonLat(sx / r.length, sy / r.length), ha: Math.round(haOf(r)) });
        out[s.c].areaHa += haOf(r);
      }
    });
    return out.map((o, c) => {
      const pts = subset.filter((p) => p.cls === c);
      const covered = pts.filter((p) => { const g = [(p.x - x0) / CELL, (p.y - y0) / CELL]; return o.rings.some((r) => inside(g, r)); }).length;
      return { rings: o.rings.map((r) => r.map((q) => toLonLat(q[0], q[1]))), labels: o.labels, areaHa: Math.round(o.areaHa), covered, n: pts.length };
    });
  }

  const scenes = {};
  const add = (key, subset, scale = 1) => { scenes[key] = tessellate(subset, scale); };
  for (const e of ERAS) {
    add(`cum:${e.key}`, P.filter((p) => p.year != null && p.year <= e.end));
    add(`new:${e.key}`, P.filter((p) => p.year != null && p.year >= e.start && p.year <= e.end), NEW_SCALE);
  }
  add('all', P);

  // 중심지: 상업+공공 밀도(누적·현재) 상위 국지 최댓값
  const centersFor = (subset) => {
    const v = surface(subset.filter((p) => CENTER_KEYS.includes(PLAN_CLASSES[p.cls].key)));
    const peaks = [];
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const c = v[j * nx + i];
      if (c < 1.2) continue;
      let isMax = true;
      for (let dj = -3; dj <= 3 && isMax; dj++) for (let di = -3; di <= 3; di++) {
        const ii = i + di, jj = j + dj;
        if ((di || dj) && ii >= 0 && jj >= 0 && ii < nx && jj < ny && v[jj * nx + ii] > c) { isMax = false; break; }
      }
      if (isMax) peaks.push({ at: toLonLat(i, j), density: Number(c.toFixed(2)) });
    }
    return peaks.sort((a, b) => b.density - a.density).slice(0, 6);
  };
  const centers = {};
  for (const e of ERAS) centers[`cum:${e.key}`] = centersFor(P.filter((p) => p.year != null && p.year <= e.end));
  centers.all = centersFor(P);

  const K450 = makeKernel(STRUCT_SIGMA), KZ = makeKernel(STRUCT_ZONE_SIGMA);
  // S: 장면에 쓰는 건물, arrowSplit: [이전 건물 마지막 연도, 신규 건물 첫 연도] (없으면 확산 방향 생략)
  const structureFor = (S, arrowSplit) => {
    const K = K450;
    // 희소 용도(공동주택·교육·공공기관)는 넓은 커널에서 밀도가 희석되므로 임계값을 더 낮추고, 단독주택은 높여 과대 표현을 줄임
    // 용도별 독립 권역(겹침 허용)이므로 경쟁 없이 넓게 퍼지는 희소·중심 용도의 임계값을 올림
    // 겹침 허용이라 경쟁 없이 퍼지는 희소 용도는 임계값을 올리고, 저밀주거지는 조금 넓게(시가지 윤곽이 드러나도록)
    const TS = { det: 0.9, row: 1.8, apt: 1.5, edu: 1.6, gov: 2.2, com: 1.3, ind: 1.2 };
    // 용도별로 따로 권역을 구해 겹침 허용(반투명으로 표시), 용도별 한 덩어리, 약한 다듬기 → 아메바형 불규칙 윤곽
    const zoneOpts = { kernel: KZ, blur: 1, minHa: 3, single: true, simplifyTol: 0.45, chaikin: 3, thresholdScale: PLAN_CLASSES.map((c) => TS[c.key] ?? 1) };
    const zones = PLAN_CLASSES.map((c, ci) => tessellate(S.filter((p) => p.cls === ci), STRUCT_SCALE, zoneOpts)[ci]);
    const cv = surface(S.filter((p) => CENTER_KEYS.includes(PLAN_CLASSES[p.cls].key)), K);
    const peaks = [];
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const c = cv[j * nx + i];
      if (c < 0.15) continue;
      let isMax = true;
      for (let dj = -15; dj <= 15 && isMax; dj++) for (let di = -15; di <= 15; di++) {
        const ii = i + di, jj = j + dj;
        if ((di || dj) && ii >= 0 && jj >= 0 && ii < nx && jj < ny && cv[jj * nx + ii] > c) { isMax = false; break; }
      }
      if (isMax) peaks.push({ x: x0 + i * CELL, y: y0 + j * CELL, density: c });
    }
    const near = (c, r) => S.filter((p) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2 <= r * r);
    const OFFICE = /(읍사무소|면사무소|동사무소|시청|행정복지센터|주민센터|출장소)/;
    const offices = P.filter((p) => p.name && OFFICE.test(p.name) && !/소방|보건|우체|관사/.test(p.name));
    const placeName = (c) => {
      let best = null, bd = (2500) ** 2;
      for (const p of offices) { const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2; if (d < bd) { bd = d; best = p; } }
      if (!best) { // 읍면동 사무소가 없으면 주변 시설명(OO파출소·OO초등학교 등)의 공통 지명 사용
        const cnt = {};
        for (const p of P) { if (!p.name || (p.x - c.x) ** 2 + (p.y - c.y) ** 2 > 1500 ** 2) continue; const m = p.name.match(/^(?:삼척(?:소방서|농협)?\s*)?([가-힣]{2,3}?)(파출소|보건지소|보건진료소|초등학교|중학교|우체국|출장소|지소|역)/); if (m && m[1] !== '삼척') cnt[m[1]] = (cnt[m[1]] ?? 0) + 1; }
        const top = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0];
        return top ? top[0] + ' 일대' : null;
      }
      const suffix = bd > 2500 ** 2 ? ' 일대' : '';
      const n = best.name.replace(/^삼척시\s*/, '');
      if (/시청/.test(n)) return '삼척 도심';
      const m = n.match(/^(.+?(읍|면|동))(사무소|행정복지센터|주민센터)/);
      if (m) return m[1] + suffix;
      return n.replace(/(출장소|사무소).*$/, '') + suffix;
    };
    let centers = peaks.map((c) => { const pts = near(c, STRUCT_CATCH_M); const mix = PLAN_CLASSES.map(() => 0); for (const p of pts) mix[p.cls]++; return { ...c, n: pts.length, mix }; })
      .filter((c) => c.n >= 150).sort((a, b) => b.n - a.n).slice(0, 12);
    if (!centers.length) return { zones, centers: [], axes: [], arrows: [], n: S.length };
    const top = centers[0];
    centers.forEach((c, i) => {
      const dTop = Math.hypot(c.x - top.x, c.y - top.y);
      c.level = i === 0 ? 0 : c.n >= top.n * 0.2 ? (dTop > 5000 ? 1 : 2) : 3; // 0 도심, 1 지역중심, 2 부도심, 3 생활권중심
      c.name = i === 0 ? '삼척 도심' : placeName(c) ?? '중심지 ' + (i + 1);
      const nonDet = c.mix.map((v, k) => [k, v]).filter(([k]) => PLAN_CLASSES[k].key !== 'det').sort((a, b) => b[1] - a[1]);
      c.dominant = c.mix.indexOf(Math.max(...c.mix));
      c.feature = nonDet[0][0]; // 단독주택 다음으로 많은 기능
    });
    // 같은 이름이 겹치면 번호를 붙임
    const seen = {};
    for (const c of centers) { seen[c.name] = (seen[c.name] ?? 0) + 1; if (seen[c.name] > 1) c.name += ' ' + seen[c.name]; }
    // 개발축: 중심지 최소신장트리 + 회랑(400m) 내 건물 밀도로 주·부 구분
    const edges = [];
    const inTree = new Set([0]);
    while (inTree.size < centers.length) {
      let best = null;
      for (const a of inTree) for (let b = 0; b < centers.length; b++) {
        if (inTree.has(b)) continue;
        const d = Math.hypot(centers[a].x - centers[b].x, centers[a].y - centers[b].y);
        if (!best || d < best.d) best = { a, b, d };
      }
      inTree.add(best.b); edges.push(best);
    }
    for (const e of edges) {
      const A = centers[e.a], B = centers[e.b], dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy;
      let cnt = 0;
      for (const p of S) { const t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / L2)); if ((p.x - A.x - t * dx) ** 2 + (p.y - A.y - t * dy) ** 2 <= 400 * 400) cnt++; }
      e.km = e.d / 1000; e.density = cnt / e.km;
    }
    const sorted = [...edges].sort((a, b) => b.density - a.density);
    sorted.forEach((e, i) => { e.level = i < Math.ceil(edges.length * 0.4) ? 0 : 1; });
    // 확산 방향: 세력권 안 1989년 이전 건물 무게중심 → 2000년 이후 건물 무게중심
    const DIRS = ['동', '북동', '북', '북서', '서', '남서', '남', '남동'];
    const arrows = [];
    for (const c of centers) {
      if (c.level === 3 || !arrowSplit) continue;
      const pts = near(c, 3000), old = pts.filter((p) => p.year != null && p.year <= arrowSplit[0]), nw = pts.filter((p) => p.year != null && p.year >= arrowSplit[1]);
      if (old.length < 30 || nw.length < 30) continue;
      const cen = (a) => [a.reduce((s, p) => s + p.x, 0) / a.length, a.reduce((s, p) => s + p.y, 0) / a.length];
      const o = cen(old), n = cen(nw), dx = n[0] - o[0], dy = n[1] - o[1], shift = Math.hypot(dx, dy);
      if (shift < 200) continue;
      const len = Math.min(2600, Math.max(900, shift * 3)), ux = dx / shift, uy = dy / shift;
      const ang = Math.atan2(dy, dx); const dir = DIRS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
      arrows.push({ center: c.name, from: toLonLatM(c.x + ux * 500, c.y + uy * 500), to: toLonLatM(c.x + ux * (500 + len), c.y + uy * (500 + len)), dir, shiftM: Math.round(shift), oldN: old.length, newN: nw.length });
    }
    return {
      zones,
      centers: centers.map((c) => ({ at: toLonLatM(c.x, c.y), name: c.name, level: c.level, n: c.n, mix: c.mix, dominant: c.dominant, feature: c.feature })),
      axes: edges.map((e) => ({ a: e.a, b: e.b, level: e.level, km: Number(e.km.toFixed(1)), density: Math.round(e.density) })),
      arrows,
      n: S.length,
    };
  };
  const structure = { scenes: {}, method: { sigmaM: STRUCT_SIGMA, scale: STRUCT_SCALE, catchM: STRUCT_CATCH_M } };
  ERAS.forEach((e, i) => {
    structure.scenes['cum:' + e.key] = structureFor(P.filter((p) => p.year != null && p.year <= e.end), i > 0 ? [ERAS[i - 1].end, e.start] : null);
  });
  structure.scenes.all = structureFor(P, [1989, 2000]);

  return {
    structure,
    classes: PLAN_CLASSES.map(({ key, label, color, threshold, desc }) => ({ key, label, color, threshold, desc })),
    eras: ERAS,
    scenes,
    centers,
    method: { cellM: CELL, sigmaM: SIGMA, minAreaHa: MIN_AREA_HA, newScale: NEW_SCALE, dominanceExp: DOMINANCE_EXP },
  };
}

// GeoJSON 피처 → 감자도 입력점(용도군이 있는 건물만, 첫 외곽링 꼭짓점 평균 위치)
export function potatoPoints(features) {
  const pts = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const cls = classifyPlan(p);
    if (cls < 0 || !f.geometry) continue;
    const ring = (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0])[0];
    if (!ring?.length) continue;
    const lon = ring.reduce((s, q) => s + q[0], 0) / ring.length, lat = ring.reduce((s, q) => s + q[1], 0) / ring.length;
    pts.push({ lon, lat, cls, name: String(p.bld_nm ?? ''), year: ageFor(p.useapr_day) == null ? null : Number(String(p.useapr_day).slice(0, 4)) });
  }
  return pts;
}

export { contours, chaikin, simplify, ringArea, inside };
