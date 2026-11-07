// 여수시 읍면동 경계(SGIS, UTM-K → 경위도)와 인구(SGIS 2015·2020·2024, KOSIS 주민등록 총인구)를 저장한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { utmkToLonLat } from './urban_change_types.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectDir, 'data', 'raw', 'yeosu');
const env = await fs.readFile(path.resolve(projectDir, '..', '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '\s*=\s*(.*)$', 'm')) || [])[1]?.trim().replace(/^['"]|['"]$/g, '');
const B = 'https://sgisapi.kostat.go.kr/OpenAPI3';
const tok = (await (await fetch(`${B}/auth/authentication.json?consumer_key=${encodeURIComponent(g('SGIS_CONSUMER_KEY'))}&consumer_secret=${encodeURIComponent(g('SGIS_CONSUMER_SECRET'))}`)).json()).result.accessToken;
const call = async (p, q) => JSON.parse(await (await fetch(`${B}${p}?accessToken=${tok}&${q}`)).text());
const SGG = '36020', YEARS = [2015, 2020, 2024];
const units = {};
for (const y of YEARS) for (const r of (await call('/stats/population.json', `year=${y}&adm_cd=${SGG}&low_search=1`)).result) {
  units[r.adm_cd] ??= { name: r.adm_nm, pop: [] }; units[r.adm_cd].pop[YEARS.indexOf(y)] = Number(r.tot_ppltn);
}
const bnd = await call('/boundary/hadmarea.geojson', `year=2024&adm_cd=${SGG}&low_search=1`);
const features = bnd.features.map((f) => ({ type: 'Feature', properties: { cd: f.properties.adm_cd, name: f.properties.adm_nm.split(' ').pop() },
  geometry: { type: f.geometry.type, coordinates: (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => poly.map((ring) => ring.map(([E, N]) => utmkToLonLat(E, N).map((v) => Number(v.toFixed(6)))))).flatMap((p) => (f.geometry.type === 'Polygon' ? p : [p])) } }));
for (const f of features) if (f.geometry.type === 'Polygon') f.geometry.coordinates = f.geometry.coordinates; // 형태 유지
// KOSIS 주민등록인구(DT_1B040A3): 1998년 통합 전은 여수시(46130)·여천시(46190)·여천군(46750) 합계로 현 시역 기준 근사
const kosis = { 46130: [185151, 185356, 185897, 185551, 187074, 188312, 329409, 326666, 323913, 320146, 315536, 310350, 305312, 301389, 297489, 295439, 295133, 293546, 293488, 292750, 292217, 291366, 290900, 290168, 288988, 286382, 283300, 282786, 280242, 276762, 274765, 271696, 267816, 263284], 46190: [73629, 73836, 74795, 77864, 80381, 80909], 46750: [74276, 71555, 68483, 65724, 63182, 61246] };
const total = {}; for (let i = 0; i < 34; i++) { const y = 1992 + i; total[y] = kosis[46130][i] + (y <= 1997 ? kosis[46190][i] + kosis[46750][i] : 0); }
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'yeosu_units.geojson'), JSON.stringify({ type: 'FeatureCollection', features }), 'utf8');
await fs.writeFile(path.join(outDir, 'yeosu_population.json'), JSON.stringify({ source: 'KOSIS 주민등록인구현황 [DT_1B040A3] (총인구), 통계청 SGIS 읍면동 인구(2015·2020·2024)', note: '1992~1997년은 통합 전 여수시·여천시·여천군 합계(현 시역 기준 근사). 2010.10부터 거주불명자, 2015.1부터 재외국민 포함', total, unitYears: YEARS, units }), 'utf8');
console.log('읍면동', features.length, Object.keys(units).length, 'total 1992', total[1992], '1997', total[1997], '1998', total[1998], '2025', total[2025]);
