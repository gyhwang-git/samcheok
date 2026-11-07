// 도시축소 3단계 분석(삼척 '도시형태3' 기준)을 임의 도시에 적용하는 공용 모듈.
// 도시별 차이는 설정(cfg)으로만 준다: 시기, 연표, 지역 구분, 인구 단위(구·군 또는 읍면동).
//  · 공간 분석: 시기 말까지 사용승인된 현존 건물로 누적 주거·산업 시가지, 시기 중 신규 시가지,
//    지역별 신축 분포, 신축 용도 구성, 단위 지역 인구 증감
import { contours, chaikin, simplify, ringArea, classifyPlan, PLAN_CLASSES } from './potato_plan.mjs';
import { ageFor } from './building_use.mjs';

const HOUSING = new Set(['01000', '02000']);
const INDUSTRY = new Set(['17000', '18000', '19000', '20000', '25000']);
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };

// rows: [[lon, lat, useapr_day, usability, grnd_flr, bld_nm], ...]
// units: GeoJSON FeatureCollection, properties {cd, name}
// pop: { total: {year: n}, unitYears: [..], units: {cd: {name, pop: [..]}} }
export function computeCity(rows, units, pop, cfg) {
  const T = cfg.thresholds ?? {};
  const us = units.features.map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polys) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { cd: String(f.properties.cd), name: f.properties.name, polys, box: [x0, y0, x1, y1] };
  });
  const unitOf = (x, y) => us.find((d) => x >= d.box[0] && x <= d.box[2] && y >= d.box[1] && y <= d.box[3] && d.polys.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h))))?.cd ?? null;
  const regionOf = {}; cfg.regions.forEach((r, i) => { for (const u of us) if (r.units.includes(u.cd) || r.units.includes(u.name)) regionOf[u.cd] = i; });
  const defaultRegion = cfg.regions.findIndex((r) => r.rest);
  for (const u of us) if (regionOf[u.cd] == null && defaultRegion >= 0) regionOf[u.cd] = defaultRegion;

  let lon0 = Infinity, lat0 = Infinity, latS = 0;
  for (const r of rows) { if (r[0] < lon0) lon0 = r[0]; if (r[1] < lat0) lat0 = r[1]; latS += r[1]; }
  const kx = Math.cos(((latS / rows.length) * Math.PI) / 180) * 111320, ky = 110540;
  const pts = rows.map(([lon, lat, apr, code, fl, nm]) => {
    const age = ageFor(apr);
    return { lon, lat, x: (lon - lon0) * kx, y: (lat - lat0) * ky, year: age == null ? null : Number(String(apr).slice(0, 4)), code, fl, cls: classifyPlan({ usability: code, bld_nm: nm, grnd_flr: fl }), u: unitOf(lon, lat) };
  });

  const CELL = cfg.cell ?? 75, SIG = cfg.sigma ?? 150, PAD = 800;
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

  // 건물 격자: [lon, lat, 1기 이전, 1기, 2기, 3기, 승인일 미상]
  const G = cfg.gridM ?? 100, P = cfg.periods, cells = new Map();
  for (const p of pts) {
    const gx = Math.floor(p.x / G), gy = Math.floor(p.y / G), k = gx + ',' + gy;
    let c = cells.get(k); if (!c) { c = [gx, gy, 0, 0, 0, 0, 0]; cells.set(k, c); }
    const b = p.year == null ? 6 : p.year < P[0].start ? 2 : p.year <= P[0].end ? 3 : p.year <= P[1].end ? 4 : 5; c[b]++;
  }
  const grid = [...cells.values()].map(([gx, gy, ...n]) => [Number((lon0 + ((gx + 0.5) * G) / kx).toFixed(5)), Number((lat0 + ((gy + 0.5) * G) / ky).toFixed(5)), ...n]);

  const uY = pop.unitYears;
  const popAt = (cd, y) => { const i = uY.indexOf(y); return i < 0 ? null : pop.units[cd]?.pop[i] ?? null; };
  const centroidOf = (d) => { let best = null, area = -1; for (const p of d.polys) { const a = ringArea(p[0]); if (a > area) { area = a; best = p[0]; } } let sx = 0, sy = 0; for (const [x, y] of best) { sx += x; sy += y; } return [Number((sx / best.length).toFixed(5)), Number((sy / best.length).toFixed(5))]; };
  const dInfo = us.map((d) => ({ cd: d.cd, name: d.name, at: centroidOf(d), region: regionOf[d.cd] ?? null, ha: Math.round(d.polys.reduce((s, p) => s + ringArea(p[0]), 0) * kx * ky / 10000), rings: d.polys.map((p) => { const sr = simplify(p[0], cfg.unitSimplify ?? 0.0006); return (sr.length >= 4 ? sr : p[0]).map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]); }).filter((r) => r.length >= 4) })); // 작은 단위가 단순화로 사라지지 않게

  const periods = {};
  for (const Pd of P) {
    const cum = pts.filter((p) => p.year != null && p.year <= Pd.end), inP = pts.filter((p) => p.year != null && p.year >= Pd.start && p.year <= Pd.end);
    const reg = cfg.regions.map(() => 0); for (const p of inP) if (p.u && regionOf[p.u] != null) reg[regionOf[p.u]]++;
    const mix = PLAN_CLASSES.map(() => 0); for (const p of inP) if (p.cls >= 0) mix[p.cls]++;
    const dpop = Pd.unitFrom == null ? null : Object.fromEntries(dInfo.map((d) => { const a = popAt(d.cd, Pd.unitFrom), b = popAt(d.cd, Pd.unitTo); return [d.cd, a && b ? { from: a, to: b, chg: ((b - a) / a) * 100 } : null]; }));
    const dnew = Object.fromEntries(dInfo.map((d) => [d.cd, inP.filter((p) => p.u === d.cd).length]));
    // 단위 지역별 이 시기 신축·산업 건물의 중심 위치(지도 주석 배치용)
    const ustat = {};
    for (const p of inP) { if (!p.u) continue; const o = (ustat[p.u] ??= { n: 0, sx: 0, sy: 0, ind: 0, ix: 0, iy: 0, apt: 0 }); o.n++; o.sx += p.lon; o.sy += p.lat; if (kind(p) === 'industry') { o.ind++; o.ix += p.lon; o.iy += p.lat; } if (p.fl >= 5) o.apt++; }
    const uNew = Object.fromEntries(Object.entries(ustat).map(([cd, o]) => [cd, { n: o.n, at: [Number((o.sx / o.n).toFixed(5)), Number((o.sy / o.n).toFixed(5))], ind: o.ind, indAt: o.ind ? [Number((o.ix / o.ind).toFixed(5)), Number((o.iy / o.ind).toFixed(5))] : null, five: o.apt }]));
    periods[Pd.key] = {
      housing: blob(cum.filter((p) => kind(p) === 'housing'), T.housing ?? 2.2, 2), industry: blob(cum.filter((p) => kind(p) === 'industry'), T.industry ?? 0.6, 2), newArea: blob(inP.filter((p) => kind(p)), T.newArea ?? 1.6, 2),
      n: inP.length, cumN: cum.length, reg, mix, five: inP.filter((p) => p.fl >= 5).length, dpop, dnew, uNew,
      pop: { from: pop.total[Pd.popFrom], to: pop.total[Pd.popTo], fromY: Pd.popFrom, toY: Pd.popTo },
    };
  }
  // 건물 데이터의 사용승인일 기록 범위: 2010~2014년 연평균의 30% 이상 기록된 마지막 해(지역마다 갱신 시점이 다름)
  const yc = {}; for (const p of pts) if (p.year != null) yc[p.year] = (yc[p.year] ?? 0) + 1;
  const base = [2010, 2011, 2012, 2013, 2014].reduce((t, y) => t + (yc[y] ?? 0), 0) / 5;
  let dataLastYear = 2014; for (let y = 2015; y <= 2026; y++) if ((yc[y] ?? 0) >= Math.max(20, base * 0.3)) dataLastYear = y;
  return {
    dataLastYear, yearCounts: yc,
    cfg: { slug: cfg.slug, name: cfg.name, unitLabel: cfg.unitLabel, basis: cfg.basis, regionText: cfg.regionText, limits: cfg.limits },
    meta: P, timeline: cfg.timeline, regions: cfg.regions.map(({ key, label, color }) => ({ key, label, color })), districts: dInfo, periods, grid, gridM: G,
    total: pop.total, popSource: pop.source, popNote: pop.note, n: pts.length, dated: pts.filter((p) => p.year != null).length, lat: latS / rows.length,
  };
}
