// 부산광역시 도시축소 3단계 분석 — 삼척 '도시형태3' 탭과 같은 기준을 적용한다.
//  · 시기: 인구 전환점으로 나눈 3단계 (자료: KOSIS 주민등록인구, DT_1B040A3)
//      1기 1963–1995  성장·정점기   (1963 직할시 승격 ~ 1995 주민등록인구 정점 388.4만)
//      2기 1996–2015  감소·외곽 확산기 (연평균 약 1.9만 명 감소, 해운대·기장으로 확산)
//      3기 2016–현재  감소 가속·신도시 집중기 (연평균 약 2.7만 명 감소, 강서·기장 증가)
//  · 공간: 시기 말까지 사용승인된 현존 건물로 누적 주거·산업 시가지, 시기 중 신규 시가지, 지역별 신축 분포,
//          신축 용도 구성, 구·군 인구 증감(성장·축소 표시)
import { contours, chaikin, simplify, ringArea, classifyPlan, PLAN_CLASSES } from './potato_plan.mjs';
import { ageFor } from './building_use.mjs';

export const BUSAN_PERIODS = [
  { key: 'q1', label: '1기', range: '1963–1995', title: '성장·정점기', start: 1963, end: 1995, color: '#1f5f86', popFrom: 1992, popTo: 1995 },
  { key: 'q2', label: '2기', range: '1996–2015', title: '감소·외곽 확산기', start: 1996, end: 2015, color: '#3a8bb0', popFrom: 1995, popTo: 2015 },
  { key: 'q3', label: '3기', range: '2016–현재', title: '감소 가속·신도시 집중기', start: 2016, end: 9999, color: '#6aa8c9', popFrom: 2015, popTo: 2025 },
];
// 연표: 행정 변화는 널리 알려진 연도만, 나머지는 KOSIS 주민등록인구 값으로 서술
export const BUSAN_TIMELINE = {
  q1: [['1963', '부산시가 정부 직할시로 승격 (경상남도에서 분리)'], ['1989', '강서구 신설 (김해군 일부 편입)'], ['1995', '부산광역시로 명칭 변경, 기장군 편입'], ['1992~1995', '주민등록인구 388만 명대 정점 (1995년 3,883,880명)']],
  q2: [['1995~2000', '해운대구 인구 30.5만 → 40.9만 명 (해운대 신시가지 입주)'], ['1995~2015', '원도심 4구(중·서·동·영도) 인구 −36.9%'], ['2009~2015', '기장군·강서구 인구 반등 (정관·명지 등 신시가지)'], ['1995~2015', '부산 인구 −37.0만 명 (−9.5%)']],
  q3: [['2015~2025', '부산 인구 −27.2만 명 (−7.7%), 연평균 감소폭 확대'], ['2015~2025', '강서구 인구 9.5만 → 15.0만 명 (+58.9%)'], ['2015~2025', '해운대구 인구 −11.9%, 원도심 4구 −15.5%'], ['2021~2025', '부산진구 인구 35.3만 → 36.5만 명 재증가']],
};
export const REGIONS = [
  { key: 'core', label: '원도심(중·서·동·영도)', color: '#1f5f86', sig: ['26110', '26140', '26170', '26200'] },
  { key: 'old', label: '기성 시가지', color: '#a8a29e', sig: ['26230', '26260', '26290', '26320', '26380', '26410', '26470', '26500', '26530'] },
  { key: 'east', label: '동부산(해운대·기장)', color: '#c2410c', sig: ['26350', '26710'] },
  { key: 'west', label: '서부산(강서)', color: '#15803d', sig: ['26440'] },
];
const HOUSING = new Set(['01000', '02000']);
const INDUSTRY = new Set(['17000', '18000', '19000', '20000', '25000']);
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };

export function computeBusan(rows, sigg, popData) {
  // 구·군 폴리곤
  const districts = sigg.features.map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0, n = 0;
    for (const p of polys) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; sx += x; sy += y; n++; }
    return { cd: String(f.properties.sig_cd), name: f.properties.sig_kor_nm, polys, box: [x0, y0, x1, y1] };
  });
  const sigOf = (x, y) => districts.find((d) => x >= d.box[0] && x <= d.box[2] && y >= d.box[1] && y <= d.box[3] && d.polys.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h))))?.cd ?? null;
  const regionOf = Object.fromEntries(REGIONS.flatMap((r, i) => r.sig.map((s) => [s, i])));

  const lon0 = 128.76, lat0 = 34.88, kx = Math.cos((35.15 * Math.PI) / 180) * 111320, ky = 110540;
  const pts = rows.map(([lon, lat, apr, code, fl, nm]) => {
    const age = ageFor(apr);
    return { lon, lat, x: (lon - lon0) * kx, y: (lat - lat0) * ky, year: age == null ? null : Number(String(apr).slice(0, 4)), code, fl, cls: classifyPlan({ usability: code, bld_nm: nm, grnd_flr: fl }), sig: sigOf(lon, lat) };
  });

  // 밀도 윤곽 (75m 격자, σ=150m)
  const CELL = 75, SIG = 150, PAD = 800;
  let maxX = 0, maxY = 0; for (const p of pts) { if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
  const W = Math.ceil((maxX + PAD * 2) / CELL), H = Math.ceil((maxY + PAD * 2) / CELL);
  const R = Math.ceil((SIG * 3) / CELL), ker = [];
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const d2 = (di * CELL) ** 2 + (dj * CELL) ** 2; if (d2 <= (SIG * 3) ** 2) ker.push([di, dj, (10000 / (2 * Math.PI * SIG * SIG)) * Math.exp(-d2 / (2 * SIG * SIG))]); }
  const toLL = (gx, gy) => [Number((lon0 + (gx * CELL - PAD) / kx).toFixed(5)), Number((lat0 + (gy * CELL - PAD) / ky).toFixed(5))];
  function blob(sub, t, minHa) {
    if (!sub.length) return [];
    const v = new Float32Array(W * H);
    for (const p of sub) { const ci = Math.round((p.x + PAD) / CELL), cj = Math.round((p.y + PAD) / CELL); for (const [di, dj, w] of ker) { const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < W && j < H) v[j * W + i] += w; } }
    return contours(v, W, H, t).map((r) => chaikin(simplify(r, 0.5), 2)).filter((r) => (ringArea(r) * CELL * CELL) / 10000 >= minHa).map((r) => r.map((q) => toLL(q[0], q[1])));
  }
  const kind = (p) => (HOUSING.has(p.code) ? 'housing' : INDUSTRY.has(p.code) ? 'industry' : null);

  // 건물 격자(100m): [lon, lat, 1963년 이전, 1기, 2기, 3기, 승인일 미상] — 웹에서 건물 대신 가볍게 표시
  const G = 100, cells = new Map();
  for (const p of pts) {
    const gx = Math.floor(p.x / G), gy = Math.floor(p.y / G), k = gx + ',' + gy;
    let c = cells.get(k); if (!c) { c = [gx, gy, 0, 0, 0, 0, 0]; cells.set(k, c); }
    const b = p.year == null ? 6 : p.year < 1963 ? 2 : p.year <= 1995 ? 3 : p.year <= 2015 ? 4 : 5; c[b]++;
  }
  const grid = [...cells.values()].map(([gx, gy, ...n]) => [Number((lon0 + ((gx + 0.5) * G) / kx).toFixed(5)), Number((lat0 + ((gy + 0.5) * G) / ky).toFixed(5)), ...n]);

  const pop = popData, Y = pop.years;
  const popAt = (cd, y) => pop.districts[cd]?.pop[Y.indexOf(y)] ?? null;
  const centroidOf = (d) => { let best = null, area = -1; for (const p of d.polys) { const a = ringArea(p[0]); if (a > area) { area = a; best = p[0]; } } let sx = 0, sy = 0; for (const [x, y] of best) { sx += x; sy += y; } return [Number((sx / best.length).toFixed(5)), Number((sy / best.length).toFixed(5))]; };
  const dInfo = districts.map((d) => ({ cd: d.cd, name: d.name, at: centroidOf(d), rings: d.polys.map((p) => simplify(p[0], 0.0006).map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))])) }));

  const periods = {};
  for (const P of BUSAN_PERIODS) {
    const cum = pts.filter((p) => p.year != null && p.year <= P.end), inP = pts.filter((p) => p.year != null && p.year >= P.start && p.year <= P.end);
    const reg = REGIONS.map(() => 0); for (const p of inP) if (p.sig && regionOf[p.sig] != null) reg[regionOf[p.sig]]++;
    const mix = PLAN_CLASSES.map(() => 0); for (const p of inP) if (p.cls >= 0) mix[p.cls]++;
    const dpop = P.key === 'q1' ? null : Object.fromEntries(dInfo.map((d) => { const a = popAt(d.cd, P.popFrom), b = popAt(d.cd, P.popTo); return [d.cd, a && b ? { from: a, to: b, chg: ((b - a) / a) * 100 } : null]; }));
    const dnew = Object.fromEntries(dInfo.map((d) => [d.cd, inP.filter((p) => p.sig === d.cd).length]));
    periods[P.key] = {
      housing: blob(cum.filter((p) => kind(p) === 'housing'), 2.2, 2), industry: blob(cum.filter((p) => kind(p) === 'industry'), 0.6, 2), newArea: blob(inP.filter((p) => kind(p)), 1.6, 2),
      n: inP.length, cumN: cum.length, reg, mix, five: inP.filter((p) => p.fl >= 5).length, dpop, dnew,
      pop: { from: pop.total[P.popFrom], to: pop.total[P.popTo], fromY: P.popFrom, toY: P.popTo },
    };
  }
  return { meta: BUSAN_PERIODS, timeline: BUSAN_TIMELINE, regions: REGIONS.map(({ key, label, color }) => ({ key, label, color })), districts: dInfo, periods, grid, gridM: G, total: pop.total, popSource: pop.source, popNote: pop.note, n: pts.length, dated: pts.filter((p) => p.year != null).length };
}
