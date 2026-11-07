// 도시변화 유형 4가지를 집계구(SGIS, 150개) 단위로 판정한다.
//  - 신규 개발 집중지역: 최근 신축이 집중되고 인구·가구가 유입된 곳
//  - 노후화 누적지역: 신축은 적고 노후 건축물이 쌓인 곳
//  - 기능 전환지역: 새로 짓는 건물의 용도 구성이 과거 건물과 크게 다른 곳(현재 주용도 기준 근사)
//  - 기능 공백지역: 건물은 남아 있으나 인구·가구·사업체가 줄고 주택당 가구수가 떨어진 곳
// 건물 지표: GIS건물통합정보(사용승인일·주용도). 생활·경제 지표: SGIS 집계구 통계 2015 → 2024(사업체는 2023).

import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyPlan, PLAN_CLASSES, simplify } from './potato_plan.mjs';
import { ageFor } from './building_use.mjs';

export const RECENT_FROM = 2015; // '최근 신축' 기준(SGIS 비교 기간 시작과 맞춤)
export const SHIFT_SPLIT = 2005; // 기능 전환: 2004년 이전 건물 vs 2005년 이후 건물
export const FUNC_GROUPS = [
  { key: 'res', label: '주거', classes: ['det', 'row', 'apt'], color: '#cfaea6' },
  { key: 'com', label: '상업', classes: ['com'], color: '#e3705f' },
  { key: 'ind', label: '산업', classes: ['ind', 'agr'], color: '#7d82a6' },
  { key: 'pub', label: '공공', classes: ['edu', 'gov'], color: '#3f7fa8' },
];
export const TYPES = [
  { key: 'new', label: '신규 개발 집중지역', color: '#2a9d5c', desc: '최근 신축이 집중되며 인구·기능 유입이 발생하는 지역' },
  { key: 'old', label: '노후화 누적지역', color: '#b0563f', desc: '신축은 적고 노후 건축물이 누적되는 지역' },
  { key: 'shift', label: '기능 전환지역', color: '#7b4fb0', desc: '주거·상업·산업 용도가 바뀌고 있는 지역' },
  { key: 'void', label: '기능 공백지역', color: '#5b6577', desc: '건축물은 남아 있지만 실제 생활·경제 기능이 약화되는 지역' },
];

// UTM-K(EPSG:5179, GRS80 횡메르카토르) → 경위도
export function utmkToLonLat(E, N) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, lon0 = (127.5 * Math.PI) / 180, lat0 = (38 * Math.PI) / 180, FE = 1000000, FN = 2000000;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const M = (phi) => a * ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const m = M(lat0) + (N - FN) / k0, mu = m / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256)), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = (E - FE) / (N1 * k0);
  const lat = p1 - ((N1 * Math.tan(p1)) / R1) * (D * D / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(p1);
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const pctChg = (a, b) => (a != null && b != null && a > 0 ? ((b - a) / a) * 100 : null);
const quant = (arr, q) => { const s = arr.filter((v) => v != null).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

export async function computeChangeTypes(features, projectDir) {
  const dir = path.join(projectDir, 'data', 'raw', 'sgis');
  const stats = JSON.parse(await fs.readFile(path.join(dir, 'sgis_oa_stats.json'), 'utf8'));
  const bnd = JSON.parse(await fs.readFile(path.join(dir, 'sgis_oa_boundary_2024_utmk.geojson'), 'utf8'));
  const [Y0, Y1] = [stats.years[0], stats.years[stats.years.length - 1]];
  const byCd = (rows) => Object.fromEntries(rows.map((r) => [r.adm_cd, r]));
  const p0 = byCd(stats.pop[Y0]), p1 = byCd(stats.pop[Y1]), c0 = byCd(stats.company[Y0]), c1 = byCd(stats.company[Y1]);

  // 집계구 폴리곤(경위도)
  const oas = bnd.features.map((f) => {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => poly.map((ring) => ring.map(([E, N]) => utmkToLonLat(E, N))));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys) for (const [x, y] of poly[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { cd: f.properties.adm_cd, emd: f.properties.emd_nm, polys, box: [x0, y0, x1, y1], b: { n: 0, dated: 0, recent: 0, old30: 0, pre: [0, 0, 0, 0], post: [0, 0, 0, 0] } };
  });
  const groupOf = Object.fromEntries(FUNC_GROUPS.flatMap((g, gi) => g.classes.map((k) => [PLAN_CLASSES.findIndex((c) => c.key === k), gi])));

  // 건물 → 집계구
  for (const f of features) {
    const g = f.geometry; if (!g) continue;
    const r = (g.type === 'Polygon' ? g.coordinates : g.coordinates[0])[0];
    const x = r.reduce((s, q) => s + q[0], 0) / r.length, y = r.reduce((s, q) => s + q[1], 0) / r.length;
    const oa = oas.find((o) => x >= o.box[0] && x <= o.box[2] && y >= o.box[1] && y <= o.box[3] && o.polys.some((poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h))));
    if (!oa) continue;
    const p = f.properties ?? {}, age = ageFor(p.useapr_day), yr = age == null ? null : Number(String(p.useapr_day).slice(0, 4)), gi = groupOf[classifyPlan(p)];
    oa.b.n++;
    if (yr != null) { oa.b.dated++; if (yr >= RECENT_FROM) oa.b.recent++; if (age >= 30) oa.b.old30++; if (gi != null) oa.b[yr < SHIFT_SPLIT ? 'pre' : 'post'][gi]++; }
  }

  // 지표
  for (const o of oas) {
    const a = p0[o.cd] ?? {}, z = p1[o.cd] ?? {}, ca = c0[o.cd] ?? {}, cz = c1[o.cd] ?? {};
    const pop0 = num(a.tot_ppltn), pop1 = num(z.tot_ppltn), hh0 = num(a.tot_family), hh1 = num(z.tot_family), ho0 = num(a.tot_house), ho1 = num(z.tot_house);
    const corp0 = num(ca.corp_cnt), corp1 = num(cz.corp_cnt), wk0 = num(ca.tot_worker), wk1 = num(cz.tot_worker);
    const b = o.b, preN = b.pre.reduce((s, v) => s + v, 0), postN = b.post.reduce((s, v) => s + v, 0);
    let shift = null, shiftFrom = null, shiftTo = null;
    if (preN >= 8 && postN >= 8) {
      shift = b.pre.reduce((s, v, i) => s + Math.abs(v / preN - b.post[i] / postN), 0) / 2; // 상이성 지수(0~1)
      const diff = b.post.map((v, i) => v / postN - b.pre[i] / preN);
      shiftFrom = diff.indexOf(Math.min(...diff)); shiftTo = diff.indexOf(Math.max(...diff));
    }
    o.m = {
      n: b.n, dated: b.dated, recent: b.recent, recentShare: b.dated ? b.recent / b.dated : null, old30Share: b.dated ? b.old30 / b.dated : null,
      preN, postN, shift, shiftFrom, shiftTo,
      pop0, pop1, popChg: pctChg(pop0, pop1), hh0, hh1, hhChg: pctChg(hh0, hh1), house0: ho0, house1: ho1, houseChg: pctChg(ho0, ho1),
      occ0: hh0 != null && ho0 ? hh0 / ho0 : null, occ1: hh1 != null && ho1 ? hh1 / ho1 : null,
      corp0, corp1, corpChg: pctChg(corp0, corp1), wk0, wk1, wkChg: pctChg(wk0, wk1), age1: num(z.avg_age),
    };
  }

  // 판정 기준: 건물 지표가 의미 있는 집계구(승인일 유효 10동 이상) 분포의 사분위 사용
  const valid = oas.filter((o) => o.m.dated >= 10);
  const T = {
    recentP75: quant(valid.map((o) => o.m.recentShare), 0.75), recentP25: quant(valid.map((o) => o.m.recentShare), 0.25),
    oldP75: quant(valid.map((o) => o.m.old30Share), 0.75), popP25: quant(oas.map((o) => o.m.popChg), 0.25), shiftMin: 0.35,
  };
  for (const o of oas) {
    const m = o.m, flags = [], why = {};
    // 신규 개발 집중: 최근 신축 비율 상위 25% + 10동 이상 + 가구 또는 인구 증가
    if (m.dated >= 10 && m.recentShare >= T.recentP75 && m.recent >= 10 && ((m.hhChg ?? -1) > 0 || (m.popChg ?? -1) > 0)) { flags.push('new'); why.new = `최근(${RECENT_FROM}~) 신축 ${m.recent}동(${(m.recentShare * 100).toFixed(0)}%), 가구 ${fmtPct(m.hhChg)}, 인구 ${fmtPct(m.popChg)}`; }
    // 노후화 누적: 30년 이상 비율 상위 25% + 최근 신축 비율 하위 25%
    if (m.dated >= 10 && m.old30Share >= T.oldP75 && m.recentShare <= T.recentP25) { flags.push('old'); why.old = `30년 이상 ${(m.old30Share * 100).toFixed(0)}%, 최근 신축 ${(m.recentShare * 100).toFixed(0)}%`; }
    // 기능 전환: 2004년 이전·2005년 이후 건물의 용도 구성 상이성 0.35 이상
    if (m.shift != null && m.shift >= T.shiftMin) { flags.push('shift'); why.shift = `용도 구성 상이성 ${m.shift.toFixed(2)} (${FUNC_GROUPS[m.shiftFrom].label} → ${FUNC_GROUPS[m.shiftTo].label} 비중 증가)`; }
    // 기능 공백: 건물 20동 이상 + 인구 감소 하위 25% + 가구 감소 + 사업체 또는 종사자 감소 + 주택당 가구수 하락 + 신축 적음
    if (m.n >= 20 && m.popChg != null && m.popChg <= T.popP25 && (m.hhChg ?? 0) < 0 && ((m.corpChg ?? 0) < 0 || (m.wkChg ?? 0) < 0) && m.occ0 != null && m.occ1 != null && m.occ1 < m.occ0 && !(m.recentShare >= T.recentP75)) {
      flags.push('void'); why.void = `인구 ${fmtPct(m.popChg)}, 가구 ${fmtPct(m.hhChg)}, 사업체 ${fmtPct(m.corpChg)}, 종사자 ${fmtPct(m.wkChg)}, 주택당 가구 ${m.occ0.toFixed(2)}→${m.occ1.toFixed(2)}`;
    }
    o.flags = flags; o.why = why;
  }
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  return {
    years: { pop: [Y0, Y1], company: [stats.company[Y0]?.length ? Y0 : null, Math.min(Y1, 2023)], recentFrom: RECENT_FROM, shiftSplit: SHIFT_SPLIT },
    types: TYPES, groups: FUNC_GROUPS.map(({ key, label, color }) => ({ key, label, color })), thresholds: T,
    oas: oas.map((o) => ({
      cd: o.cd, emd: o.emd, flags: o.flags, why: o.why, m: o.m,
      rings: o.polys.map((poly) => simplify(poly[0], 0.00004).map(([x, y]) => [r5(x), r5(y)])),
    })),
  };
}
function fmtPct(v) { return v == null ? '–' : (v > 0 ? '+' : '') + v.toFixed(0) + '%'; }
