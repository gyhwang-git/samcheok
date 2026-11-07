// SGIS(통계지리정보서비스) 집계구 단위 인구·가구·주택·사업체·종사자 통계와 집계구 경계(UTM-K)를 내려받는다.
// 인증: 상위 폴더 .env 의 SGIS_CONSUMER_KEY / SGIS_CONSUMER_SECRET
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectDir, 'data', 'raw', 'sgis');
const env = await fs.readFile(path.resolve(projectDir, '..', '.env'), 'utf8');
const g = (k) => (env.match(new RegExp('^' + k + '\s*=\s*(.*)$', 'm')) || [])[1]?.trim().replace(/^['"]|['"]$/g, '');
const B = 'https://sgisapi.kostat.go.kr/OpenAPI3';
const auth = await (await fetch(`${B}/auth/authentication.json?consumer_key=${encodeURIComponent(g('SGIS_CONSUMER_KEY'))}&consumer_secret=${encodeURIComponent(g('SGIS_CONSUMER_SECRET'))}`)).json();
if (auth.errCd !== 0) throw new Error('SGIS 인증 실패: ' + auth.errMsg);
const tok = auth.result.accessToken;
const call = async (p, q) => { for (let i = 0; i < 3; i++) { const t = await (await fetch(`${B}${p}?accessToken=${tok}&${q}`)).text(); try { return JSON.parse(t); } catch { await new Promise((r) => setTimeout(r, 800)); } } throw new Error('SGIS 응답 오류 ' + p); };

const emd = (await call('/stats/population.json', 'year=2020&adm_cd=32070&low_search=1')).result.map((r) => ({ cd: r.adm_cd, nm: r.adm_nm }));
const YEARS = [2015, 2020, 2024];
const pop = {}, company = {};
for (const y of YEARS) {
  pop[y] = []; company[y] = [];
  for (const e of emd) {
    const p = await call('/stats/population.json', `year=${y}&adm_cd=${e.cd}&low_search=1`);
    if (p.errCd === 0) pop[y].push(...p.result.map((r) => ({ ...r, emd_cd: e.cd, emd_nm: e.nm })));
    else console.warn('population', y, e.nm, p.errMsg);
    const c = await call('/stats/company.json', `year=${Math.min(y, 2023)}&adm_cd=${e.cd}&low_search=1`);
    if (c.errCd === 0) company[y].push(...c.result.map((r) => ({ ...r, emd_cd: e.cd, emd_nm: e.nm })));
    else console.warn('company', y, e.nm, c.errMsg);
  }
  console.log(y, '집계구 인구', pop[y].length, '사업체', company[y].length);
}
const emdPop = {};
for (const y of [2015, 2016, 2018, 2020, 2022, 2024]) emdPop[y] = (await call('/stats/population.json', `year=${y}&adm_cd=32070&low_search=1`)).result;
const bnd = {};
for (const e of emd) {
  const j = await call('/boundary/statsarea.geojson', `year=2024&adm_cd=${e.cd}`);
  if (j.errCd !== undefined && j.errCd !== 0) { console.warn('boundary', e.nm, j.errMsg); continue; }
  for (const f of j.features) bnd[f.properties.adm_cd] = { ...f, properties: { ...f.properties, emd_cd: e.cd, emd_nm: e.nm } };
}
console.log('집계구 경계', Object.keys(bnd).length);
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'sgis_oa_stats.json'), JSON.stringify({ source: 'SGIS OpenAPI3 stats/population, stats/company (집계구)', years: YEARS, emd, pop, company, emdPop }), 'utf8');
await fs.writeFile(path.join(outDir, 'sgis_oa_boundary_2024_utmk.geojson'), JSON.stringify({ type: 'FeatureCollection', crs: 'EPSG:5179', features: Object.values(bnd) }), 'utf8');
