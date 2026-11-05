// 논문 기반 시기별 도시형태 지도 자료.
// 출처: 박훈(2020), 「삼척시 지적자료 분석을 통한 근·현대 도시형태 변화 연구」, 대한건축학회연합논문집 22(1), pp.27-38.
// 시기 구분(1기 1910-1956, 2기 1957-1981, 3기 1982-현재)과 장소·사건·형태 서술은 논문에서 가져오고,
// 위치는 건물 데이터의 건물명(죽서루, 동사무소, 시멘트 공장 등)으로 잡는다.
// 2·3기 시가지 윤곽은 현존 건물의 사용승인일로 그린다(논문 Figure 7·8의 Housing/Industrial Area 범례를 따름).

import { contours, chaikin, simplify, ringArea, inside, classifyPlan, PLAN_CLASSES, ERAS } from './potato_plan.mjs';
import { ageFor } from './building_use.mjs';

export const FORM_PERIODS = [
  { key: 'p1', label: '1기', range: '1910–1956', title: '근대적 시가지 형성기', politics: '산업구조 중심의 도시공간 전개', start: 1800, end: 1956, color: '#9c5b3b' },
  { key: 'p2', label: '2기', range: '1957–1981', title: '내부로의 확장기', politics: '도시환경 구조 변화에 따른 정치 중심지 중심의 도시공간 전개', start: 1957, end: 1981, color: '#d4912a' },
  { key: 'p3', label: '3기', range: '1982–현재', title: '외연확장기', politics: '도시 성숙기의 외부 확장', start: 1982, end: 9999, color: '#4b7bb5' },
];

// 논문 대상 시가지(약 8.9km², 시청 중심 시가화지역 + 오십천 남측 시멘트 공장)를 감싸는 범위
export const FORM_BBOX = [129.145, 37.422, 129.198, 37.462];

// 논문 Table 14 (시가화지역 건축물대장 확인 3,935동 기준)
export const PAPER_STATS = {
  p1: { n: 36, detached: 63.8, oneFloor: 94.0, five: 0, note: '건축물 기록 상당수 소실·부존재' },
  p2: { n: 769, detached: 79.0, oneFloor: 76.7, five: 2.7 },
  p3: { n: 3181, detached: 50.1, oneFloor: 45.6, five: 8.9 },
};

const HOUSING = new Set(['01000', '02000']);
const INDUSTRY = new Set(['17000', '18000', '19000', '20000', '25000']);

const ANCHOR_RULES = {
  jukseoru: { re: /^죽서루$/ },
  seongnae: { re: /성내동사무소/ },
  jeongna: { re: /정라동사무소/ },
  port: { re: /삼척수산업협동조합/ },
  cement: { re: /동양시멘트주식회사 삼척공장/ },
  namyang: { re: /남양동사무소/ },
  cityhall: { re: /^삼척시청사?$/ },
  police: { re: /^삼척경찰서$/ },
  market: { re: /^중앙시장$/ },
  gyodongOffice: { re: /교동사무소/ },
};

function centroid(f) {
  const g = f.geometry; if (!g) return null;
  const ring = (g.type === 'Polygon' ? g.coordinates : g.coordinates[0])[0];
  return [ring.reduce((s, q) => s + q[0], 0) / ring.length, ring.reduce((s, q) => s + q[1], 0) / ring.length];
}
const yearOf = (p) => (ageFor(p.useapr_day) == null ? null : Number(String(p.useapr_day).slice(0, 4)));

export function computeUrbanForm(features) {
  const [bx0, by0, bx1, by1] = FORM_BBOX;
  const lat0 = (by0 + by1) / 2, kx = Math.cos((lat0 * Math.PI) / 180) * 111320, ky = 110540;
  const pts = [];
  const anchors = {};
  for (const f of features) {
    const p = f.properties ?? {}, c = centroid(f);
    if (!c) continue;
    for (const [k, r] of Object.entries(ANCHOR_RULES)) if (!anchors[k] && r.re.test(String(p.bld_nm ?? ''))) anchors[k] = c;
    if (c[0] < bx0 || c[0] > bx1 || c[1] < by0 || c[1] > by1) continue;
    pts.push({ lon: c[0], lat: c[1], x: (c[0] - bx0) * kx, y: (c[1] - by0) * ky, year: yearOf(p), code: String(p.usability ?? '').trim(), floors: Number(p.grnd_flr) || 0, name: String(p.bld_nm ?? ''), cls: classifyPlan(p), date: String(p.useapr_day ?? '') });
  }
  // 교동 택지(논문: 1995-1998 조성, 공동주택 단지): 교동사무소 북동쪽 구릉지(1.3km 이내)에 1995-2005년 승인된 5층 이상 공동주택
  const go = anchors.gyodongOffice;
  const gy = go ? pts.filter((p) => p.code === '02000' && p.floors >= 5 && p.year >= 1995 && p.year <= 2005 && p.lon >= go[0] && p.lat >= go[1] - 0.0015 && Math.hypot((p.lon - go[0]) * kx, (p.lat - go[1]) * ky) <= 1300) : [];
  if (gy.length) anchors.gyodong = [gy.reduce((s, p) => s + p.lon, 0) / gy.length, gy.reduce((s, p) => s + p.lat, 0) / gy.length];
  const missing = Object.keys(ANCHOR_RULES).filter((k) => !anchors[k]);
  if (missing.length) console.warn('도시형태: 위치를 찾지 못한 장소', missing);

  // 밀도 등치선으로 시가지 윤곽 생성
  const CELL = 20, SIG = 55, W = Math.ceil((bx1 - bx0) * kx / CELL) + 1, H = Math.ceil((by1 - by0) * ky / CELL) + 1;
  const R = Math.ceil(SIG * 3 / CELL), ker = [];
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const d2 = (di * CELL) ** 2 + (dj * CELL) ** 2; if (d2 <= (SIG * 3) ** 2) ker.push([di, dj, (10000 / (2 * Math.PI * SIG * SIG)) * Math.exp(-d2 / (2 * SIG * SIG))]); }
  const toLL = (gx, gy2) => [Number((bx0 + gx * CELL / kx).toFixed(5)), Number((by0 + gy2 * CELL / ky).toFixed(5))];
  function blob(sub, threshold, minHa = 0.6) {
    const v = new Float32Array(W * H);
    for (const p of sub) { const ci = Math.round(p.x / CELL), cj = Math.round(p.y / CELL); for (const [di, dj, w] of ker) { const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < W && j < H) v[j * W + i] += w; } }
    return contours(v, W, H, threshold).map((r) => chaikin(simplify(r, 0.6), 3)).filter((r) => ringArea(r) * CELL * CELL / 10000 >= minHa).map((r) => r.map((q) => toLL(q[0], q[1])));
  }
  const kind = (p) => (HOUSING.has(p.code) ? 'housing' : INDUSTRY.has(p.code) ? 'industry' : p.code ? 'other' : null);
  const stats = (sub) => {
    const n = sub.length, det = sub.filter((p) => p.code === '01000').length, one = sub.filter((p) => p.floors === 1).length, five = sub.filter((p) => p.floors >= 5).length;
    return { n, detached: n ? (det / n) * 100 : 0, oneFloor: n ? (one / n) * 100 : 0, five: n ? (five / n) * 100 : 0 };
  };
  const periods = {};
  for (const P of FORM_PERIODS) {
    const cum = pts.filter((p) => p.year != null && p.year <= P.end);
    const inP = pts.filter((p) => p.year != null && p.year >= P.start && p.year <= P.end);
    periods[P.key] = {
      housing: blob(cum.filter((p) => kind(p) === 'housing'), 4),
      industry: blob(cum.filter((p) => kind(p) === 'industry'), 0.9, 0.4),
      newArea: blob(inP.filter((p) => kind(p)), 4),
      dataStats: stats(inP),
      cumN: cum.length,
    };
  }
  periods.p3.gyodongApts = gy.length;
  periods.p3.gyodongArea = blob(gy, 0.25, 0.5);

  const A = anchors;
  const north = A.seongnae && A.jukseoru ? [A.seongnae[0] + (A.seongnae[0] - A.jukseoru[0]) * 1.2, A.seongnae[1] + (A.seongnae[1] - A.jukseoru[1]) * 1.2] : null;
  // 논문 서술 → 지도 주석. kind: zone(개략 범위, rx·ry m) | marker | arrow(from→to) | axis(경로)
  const notes = {
    p1: [
      { kind: 'zone', at: A.jukseoru && A.seongnae && [(A.jukseoru[0] + A.seongnae[0]) / 2, (A.jukseoru[1] + A.seongnae[1]) / 2], rx: 330, ry: 420, cat: 'housing', title: '구시가지 — 삼척읍성·죽서루 일대', text: '성내동·읍상동. 읍성과 관아가 있던 행정 중심. 필지는 230–850㎡의 불규칙한 형태가 다수.', ref: '4.1, Table 7' },
      { kind: 'zone', at: A.jeongna, rx: 260, ry: 330, cat: 'housing', title: '정라진 어항·어촌', text: '오십천 하류의 자연 항구(1916년 인공 축조). 산업 거점. 해안 가로를 따라 150–360㎡ 필지가 1열로 나열.', ref: '4.1, 각주 10' },
      { kind: 'zone', at: A.cement, rx: 380, ry: 300, cat: 'industry', title: '오노다시멘트 삼척공장', text: '1937년 착공, 1942년 준공(연 8.4만 톤). 오십천 건너편. 1956년 동양제당이 인수 → 1957년 동양세멘트.', ref: '4.1' },
      { kind: 'axis', path: [A.jukseoru, A.seongnae, north].filter(Boolean), title: '북측 접근가로(현 대학로)', text: '북쪽(현 동해시)에서 시가지로 들어오는 동선. 이후 대학로로 정비.', ref: '4.1, 6장', approx: true },
      { kind: 'marker', at: A.jukseoru, title: '죽서루', text: '읍성 서편 절벽 위 누각. 구시가지의 기준점.', ref: '3.2' },
    ],
    p2: [
      { kind: 'marker', at: A.namyang, title: '남산 절단·오십천 개조(1962–1970)', text: '오십천 수로를 바꾸고 약 10만 평을 매립해 현 중심 시가지 택지 확보. 가로는 중앙 십자형 + 환상형, 필지 45–2,800㎡. 남양동 7-46 일대에 45㎡ 동일 필지가 반복되는 이주민 정착지.', ref: '4.2, Figure 5, Table 10' },
      { kind: 'arrow', from: A.seongnae, to: A.namyang, title: '행정 중심 이동', text: '성내동·읍상동 → 남양동 일대.', ref: 'Table 3' },
      { kind: 'marker', at: A.port, title: '정라항 → 삼척항(1966)', text: '1966년 개칭, 1967년 안벽 150m 축조(500톤급 2척 동시 접안). 시멘트 산업 지원 항만.', ref: '4.2, Figure 6' },
      { kind: 'marker', at: A.cement, title: '동양시멘트 증설', text: '1959·1961·1967·1975년 증설.', ref: 'Table 3' },
      { kind: 'marker', at: A.seongnae, title: '성내동 세가로 확장', text: '대학로 가로가 죽서루까지 이어지고, 세가로를 따라 시가지 확장. 필지 분화(45–900㎡).', ref: 'Table 11' },
    ],
    p3: [
      { kind: 'marker', at: A.gyodong, title: '교동 택지개발(1995–1998)', text: '공동주택 단지 중심의 대표 택지. 구릉 지형을 따라 조성되어 시가지를 내려다봄. 약 1만 4천 명 거주.', ref: '4.3' },
      { kind: 'arrow', from: A.namyang, to: A.gyodong, title: '시가지 중심 이동', text: '교동 택지가 점진적으로 중심 기능을 하면서 기존 중심 시가지는 일부 공동화.', ref: '4.3' },
      { kind: 'axis', path: [A.jukseoru, A.seongnae, north].filter(Boolean), title: '대학로 조성(1980년대~)', text: '상권이 형성되어 시민과 강원대 학생이 찾는 가로공간이 됨.', ref: '6장', approx: true },
      { kind: 'marker', at: A.cityhall, title: '행정 기능 집적', text: '삼척시청·우체국·경찰서, 고속·시외버스 터미널. 1995년 삼척군·삼척시 통합.', ref: '4.3' },
      { kind: 'marker', at: A.market, title: '중앙시장 일대 — 일부 공동화', text: '삼척에서 가장 큰 상권이지만 교동 택지로 중심이 옮겨가며 기존 중심 시가지에 공동화 현상.', ref: '4.3' },
      { kind: 'marker', at: A.cement, title: '시멘트 부지 지속 성장', text: '오십천을 사이에 두고 삼척항 유역과 하천 남측 부지의 건축물 증가.', ref: '4.3, Figure 7·8' },
    ],
  };
  for (const k in notes) notes[k] = notes[k].filter((n) => (n.at ?? n.from ?? n.path?.[0]) && (n.kind !== 'arrow' || (n.from && n.to)));
  // ---------- 도시형태2: 3기(1982-현재)를 공간구조도 탭의 승인연도 구간으로 세분 ----------
  const SUB = ERAS.filter((e) => e.end >= 1982).map((e) => ({ key: e.key, label: e.start <= 1982 ? '1982–1989' : e.label, start: Math.max(1982, e.start), end: e.end }));
  // 논문 Table 14의 3기 연대별 건축물 수(-1990, -2000, -2010, -2019). 구간 경계가 1년씩 다를 수 있음
  const PAPER_SUB = { e1980: { n: 660, label: '–1990' }, e1990: { n: 1259, label: '–2000' }, e2000: { n: 862, label: '–2010' }, e2010: { n: 400, label: '–2019' } };
  const toRing = (r) => r.map((q) => [(q[0] - bx0) * kx / CELL, (q[1] - by0) * ky / CELL]);
  const centroidOf = (a) => [a.reduce((t, p) => t + p.lon, 0) / a.length, a.reduce((t, p) => t + p.lat, 0) / a.length];
  const DIRS = ['동', '북동', '북', '북서', '서', '남서', '남', '남동'];
  const landmark = (re) => pts.filter((p) => re.test(p.name) && p.year != null).sort((a, b) => a.year - b.year)[0];
  const LM = {
    cityhall82: landmark(/^삼척시청$/), cityhall91: landmark(/^삼척시청사$/), police: landmark(/^삼척경찰서$/),
    cheongsol: landmark(/교동청솔2차아파트/), koaru: landmark(/교동 코아루/),
  };
  const lmNote = (lm, title, text, ref) => (lm ? { kind: 'marker', at: [lm.lon, lm.lat], title: title + ' (' + lm.year + ')', text, ref } : null);
  const gy95 = gy.filter((p) => p.year <= 1999), gy00 = gy.filter((p) => p.year >= 2000);
  const sub = SUB.map((e, i) => {
    const cum = pts.filter((p) => p.year != null && p.year <= e.end);
    const inS = pts.filter((p) => p.year != null && p.year >= e.start && p.year <= e.end);
    const prev = pts.filter((p) => p.year != null && p.year < e.start);
    const mix = PLAN_CLASSES.map(() => 0); for (const p of inS) if (p.cls >= 0) mix[p.cls]++;
    // 신규 개발 덩어리: 해당 구간 승인 건물 밀도 윤곽 + 덩어리 안의 우세 용도(공간구조도 범례)
    const blobs = blob(inS.filter((p) => p.cls >= 0), 3.2, 0.5).map((r) => {
      const R = toRing(r), cnt = PLAN_CLASSES.map(() => 0);
      for (const p of inS) if (p.cls >= 0 && inside([p.x / CELL, p.y / CELL], R)) cnt[p.cls]++;
      const n = cnt.reduce((a, b) => a + b, 0), dom = cnt.indexOf(Math.max(...cnt));
      const c = centroidOf(r.map((q) => ({ lon: q[0], lat: q[1] })));
      return { ring: r, n, dom, share: n ? cnt[dom] / n : 0, at: c };
    }).filter((b) => b.n >= 8).sort((a, b) => b.n - a.n);
    let shift = null;
    if (prev.length >= 30 && inS.length >= 30) {
      const o = centroidOf(prev), nw = centroidOf(inS), dx = (nw[0] - o[0]) * kx, dy = (nw[1] - o[1]) * ky, d = Math.hypot(dx, dy);
      shift = { from: o, to: nw, m: Math.round(d), dir: DIRS[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8] };
    }
    const five = inS.filter((p) => p.floors >= 5).length, apt = inS.filter((p) => p.cls === PLAN_CLASSES.findIndex((c) => c.key === 'apt')).length;
    const north = A.seongnae && A.jukseoru ? [A.seongnae[0] + (A.seongnae[0] - A.jukseoru[0]) * 1.2, A.seongnae[1] + (A.seongnae[1] - A.jukseoru[1]) * 1.2] : null;
    const notes = {
      e1980: [
        { kind: 'axis', path: [A.jukseoru, A.seongnae, north].filter(Boolean), title: '대학로 조성(1980년대)', text: '1980년대 대학로가 조성되며 상권 형성. 시민과 강원대 학생이 찾는 가로공간.', ref: '6장', approx: true },
        lmNote(LM.cityhall82, '삼척시청', '현 시가지 북측에 행정 기능 입지(건축물대장 사용승인 연도).', '4.3'),
      ],
      e1990: [
        gy95.length ? { kind: 'area', key: 'gy95', title: '교동 택지개발(1995–1998)', text: '공동주택 단지 중심의 대표 택지. 구릉 지형을 따라 조성(데이터: 1995–1999년 승인 5층 이상 공동주택 ' + gy95.length + '동).', ref: '4.3', at: centroidOf(gy95) } : null,
        lmNote(LM.cityhall91, '삼척시청사', '1995년 1월 삼척군·삼척시 통합으로 통합 삼척시 출범.', '4.3, 각주 15'),
      ],
      e2000: [
        gy00.length ? { kind: 'area', key: 'gy00', title: '교동 택지 후속 공동주택', text: '교동 택지가 기본 골격을 갖춘 뒤 주거·도시기능 시설이 계속 들어섬(데이터: 2000년 이후 승인 5층 이상 공동주택 ' + gy00.length + '동, 청솔2차·코아루 등).', ref: '4.3', at: centroidOf(gy00) } : null,
        A.namyang && A.gyodong ? { kind: 'arrow', from: A.namyang, to: A.gyodong, title: '시가지 중심 이동', text: '교동 택지가 점진적으로 중심 기능을 하게 됨. 논문은 시점을 특정하지 않아 교동 택지 이후 시기에 표시.', ref: '4.3' } : null,
        lmNote(LM.police, '삼척경찰서', '행정 기능 담당 시설의 이전·입지.', '4.3'),
        A.cement ? { kind: 'marker', at: A.cement, title: '시멘트 부지 지속 성장', text: '논문 Figure 7(1983)과 Figure 8(2004) 비교: 오십천 양안 부지의 건축물 증가.', ref: '4.3, Figure 7·8' } : null,
      ],
      e2010: [
        A.market ? { kind: 'marker', at: A.market, title: '중앙시장 일대 — 일부 공동화', text: '논문 작성 시점(2019년 현장조사) 현황: 기존 중심 시가지 상권의 일부 공동화.', ref: '4.3' } : null,
      ],
      e2020: [],
    }[e.key].filter(Boolean);
    return {
      ...e, n: inS.length, cumN: cum.length, mix, five, apt, shift, notes,
      housing: blob(cum.filter((p) => kind(p) === 'housing'), 4),
      industry: blob(cum.filter((p) => kind(p) === 'industry'), 0.9, 0.4),
      blobs, paper: PAPER_SUB[e.key] ?? null,
    };
  });
  const form2 = { sub, gy95: gy95.length ? blob(gy95, 0.25, 0.5) : [], gy00: gy00.length ? blob(gy00, 0.25, 0.3) : [] };

  return { periods, notes, anchors, bbox: FORM_BBOX, meta: FORM_PERIODS, paper: PAPER_STATS, studyN: pts.length, form2 };
}
