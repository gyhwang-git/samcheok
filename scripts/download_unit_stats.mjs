// 도시의 읍면동 경계(SGIS, UTM-K → 경위도)와 읍면동 인구(SGIS 2015·2020·2024)를 저장하고,
// KOSIS 총인구(data/raw/<slug>/<slug>_kosis_total.json)와 합쳐 <slug>_population.json 을 만든다.
// 사용: node scripts/download_unit_stats.mjs <slug> <SGIS 시군구코드[,코드]> ["메모"]
//   예) node scripts/download_unit_stats.mjs jeonju 35011,35012
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { utmkToLonLat } from './urban_change_types.mjs';

const [SLUG, CODES, NOTE = ''] = process.argv.slice(2);
if (!SLUG || !CODES) throw new Error('사용: node scripts/download_unit_stats.mjs <slug> <SGIS코드[,코드]>');
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectDir, 'data', 'raw', SLUG);
const env = await fs.readFile(path.resolve(projectDir, '..', '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '\\s*=\\s*(.*)$', 'm')) || [])[1]?.trim().replace(/^['"]|['"]$/g, '');
const B = 'https://sgisapi.kostat.go.kr/OpenAPI3';
const tok = (await (await fetch(`${B}/auth/authentication.json?consumer_key=${encodeURIComponent(g('SGIS_CONSUMER_KEY'))}&consumer_secret=${encodeURIComponent(g('SGIS_CONSUMER_SECRET'))}`)).json()).result.accessToken;
const call = async (p, q) => JSON.parse(await (await fetch(`${B}${p}?accessToken=${tok}&${q}`)).text());
const YEARS = [2015, 2017, 2020, 2024], units = {}, features = [];
for (const sgg of CODES.split(',')) {
  // SGIS가 가끔 한 해 전체를 N/A로 돌려줌 → 값이 하나도 없으면 잠시 뒤 다시 요청
  const yearRows = async (y) => { for (let k = 0; k < 5; k++) { const rs = (await call('/stats/population.json', `year=${y}&adm_cd=${sgg}&low_search=1`)).result ?? []; if (rs.some((r) => Number(r.tot_ppltn) > 0)) return rs; await new Promise((res) => setTimeout(res, 3000 * (k + 1))); } console.warn(SLUG, y, '인구 값 없음'); return []; };
  for (const y of YEARS) for (const r of await yearRows(y)) {
    units[r.adm_cd] ??= { name: r.adm_nm, pop: [] }; units[r.adm_cd].pop[YEARS.indexOf(y)] = Number(r.tot_ppltn) || null;
  }
  const bnd = await call('/boundary/hadmarea.geojson', `year=2024&adm_cd=${sgg}&low_search=1`);
  for (const f of bnd.features ?? []) features.push({ type: 'Feature', properties: { cd: f.properties.adm_cd, name: f.properties.adm_nm.split(' ').pop() },
    geometry: { type: f.geometry.type, coordinates: (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => poly.map((ring) => ring.map(([E, N]) => utmkToLonLat(E, N).map((v) => Number(v.toFixed(6)))))).flatMap((p) => (f.geometry.type === 'Polygon' ? p : [p])) } });
}
const total = JSON.parse(await fs.readFile(path.join(outDir, `${SLUG}_kosis_total.json`), 'utf8'));
await fs.writeFile(path.join(outDir, `${SLUG}_units.geojson`), JSON.stringify({ type: 'FeatureCollection', features }), 'utf8');
await fs.writeFile(path.join(outDir, `${SLUG}_population.json`), JSON.stringify({ source: 'KOSIS 주민등록인구현황 [DT_1B040A3] (총인구), 통계청 SGIS 읍면동 인구(2015·2017·2020·2024)', note: ('2010.10부터 거주불명자, 2015.1부터 재외국민 포함. ' + NOTE).trim(), total, unitYears: YEARS, units }), 'utf8');
console.log(SLUG, '읍면동 경계', features.length, '인구', Object.keys(units).length, Object.values(units).map((u) => u.name).join(' '));
