// 도시의 GIS건물통합정보(브이월드 LT_C_BLDGINFO)를 내려받아 건물 중심점과 주요 속성만 저장한다.
// 사용: node scripts/download_city.mjs <slug> <시군구코드 접두> <검색상자 x0,y0,x1,y1> [칸 수]
//   예) node scripts/download_city.mjs busan 26 128.7,34.8,129.4,35.45 3
//       node scripts/download_city.mjs yeosu 46130 127.0,33.9,128.0,35.0 3
// 경계상자를 N×N 칸으로 나눠 조회하고, 해당 시군구 경계 안의 건물만 남긴다. 칸·페이지 단위로 이어받기 가능.
// 출력: data/raw/<slug>/<slug>_buildings_points.json  [[lon, lat, useapr_day, usability, grnd_flr, bld_nm], ...]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [SLUG = 'busan', PREFIX = '26', SEARCH = '128.7,34.8,129.4,35.45', NARG = '3'] = process.argv.slice(2);
const outDir = path.join(projectDir, 'data', 'raw', SLUG);
const env = await fs.readFile(path.resolve(projectDir, '..', '.env'), 'utf8');
const key = env.match(/^\s*V-WORLD_KEY\s*=\s*["']?([^"'\r\n]+)/m)?.[1]?.trim();
if (!key) throw new Error('.env 에 V-WORLD_KEY 가 없습니다.');

async function req(params) {
  const q = new URLSearchParams({ service: 'data', version: '2.0', request: 'GetFeature', format: 'json', key, domain: 'localhost', geometry: 'true', attribute: 'true', crs: 'EPSG:4326', ...params });
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch('https://api.vworld.kr/req/data?' + q);
      const b = await r.json();
      if (b?.response?.status === 'OK') return b.response.result.featureCollection.features || [];
      if (b?.response?.status === 'NOT_FOUND') return [];
      throw new Error(b?.response?.error?.text || b?.response?.status);
    } catch (e) { if (i === 9) throw e; console.log(`  재시도 ${i + 1}: ${e.cause?.code || e.message}`); await new Promise((res) => setTimeout(res, Math.min(60000, 2000 * 2 ** i))); }
  }
}
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const inGeom = (x, y, g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)));

// 부산 시군구 경계(26xxx)
const sigg = (await req({ data: 'LT_C_ADSIGG_INFO', geomFilter: `BOX(${SEARCH})`, size: '100', page: '1' })).filter((f) => PREFIX.split(',').some((p) => String(f.properties?.sig_cd).startsWith(p))); // 여러 코드는 쉼표로
if (!sigg.length) throw new Error(SLUG + ' 시군구 경계를 찾지 못했습니다.');
const all = sigg.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flatMap((p) => p[0]));
const B = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
console.log(SLUG + ' 시군구', sigg.length, '경계상자', B.map((v) => v.toFixed(3)).join(','));
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, `${SLUG}_sigg.geojson`), JSON.stringify({ type: 'FeatureCollection', features: sigg.map((f) => ({ type: 'Feature', properties: { sig_cd: f.properties.sig_cd, sig_kor_nm: f.properties.sig_kor_nm }, geometry: f.geometry })) }), 'utf8');

// 칸·페이지 단위로 디스크에 이어 저장 → 중간에 끊겨도 다시 실행하면 이어서 받음
const tileDir = path.join(outDir, 'tiles'); await fs.mkdir(tileDir, { recursive: true });
const N = Number(NARG), seen = new Set(), out = [];
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const box = [B[0] + ((B[2] - B[0]) * i) / N, B[1] + ((B[3] - B[1]) * j) / N, B[0] + ((B[2] - B[0]) * (i + 1)) / N, B[1] + ((B[3] - B[1]) * (j + 1)) / N];
  let kept = 0;
  const tf = path.join(tileDir, `t${i}_${j}.ndjson`), sf = path.join(tileDir, `t${i}_${j}.state.json`);
  const st = JSON.parse(await fs.readFile(sf, 'utf8').catch(() => '{"page":0,"done":false}'));
  if (st.page > 0) { const prev = (await fs.readFile(tf, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l)); for (const r of prev) { out.push(r); kept++; } console.log(`칸 ${i},${j}: 저장분 ${prev.length.toLocaleString()}건, 페이지 ${st.page}까지 완료${st.done ? '(칸 완료)' : ''}`); }
  if (st.done) continue;
  let stale = 0; // 새 건물이 없는 페이지가 이어지면(브이월드가 같은 결과를 반복) 이 칸을 끝냄
  for (let page = st.page + 1; page <= 1000; page++) {
    const pageRows = []; let fresh = 0;
    const fs_ = await req({ data: 'LT_C_BLDGINFO', geomFilter: `BOX(${box.join(',')})`, size: '1000', page: String(page) });
    for (const f of fs_) {
      const g = f.geometry; if (!g) continue;
      const ring = (g.type === 'Polygon' ? g.coordinates : g.coordinates[0])[0];
      const x = ring.reduce((s, q) => s + q[0], 0) / ring.length, y = ring.reduce((s, q) => s + q[1], 0) / ring.length;
      if (x < box[0] || x >= box[2] || y < box[1] || y >= box[3]) continue; // 칸 경계에 걸친 건물은 중심점이 속한 칸에서만
      const p = f.properties ?? {}, id = f.id ?? `${x.toFixed(6)},${y.toFixed(6)}`;
      if (seen.has(id)) continue; seen.add(id); fresh++;
      if (!sigg.some((s) => inGeom(x, y, s.geometry))) continue;
      const row = [Number(x.toFixed(5)), Number(y.toFixed(5)), String(p.useapr_day ?? ''), String(p.usability ?? ''), Number(p.grnd_flr) || 0, String(p.bld_nm ?? ''), String(p.sig_cd ?? p.bjd_cd ?? '').slice(0, 5)];
      out.push(row); pageRows.push(row); kept++;
    }
    if (pageRows.length) await fs.appendFile(tf, pageRows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    await fs.writeFile(sf, JSON.stringify({ page, done: fs_.length < 1000 }), 'utf8');
    if (page % 20 === 0) console.log(`칸 ${i},${j} 페이지 ${page}: 누적 ${out.length.toLocaleString()}건`);
    stale = fresh ? 0 : stale + 1;
    if (fs_.length < 1000 || stale >= 20) { if (stale >= 20) { console.log(`칸 ${i},${j}: 새 건물 없는 페이지 20회 → 다음 칸`); await fs.writeFile(sf, JSON.stringify({ page, done: true }), 'utf8'); } break; }
    if (page === 1000) throw new Error('페이지 한도 초과');
  }
  console.log(`칸 ${i},${j} 완료: ${kept.toLocaleString()}건 (전체 ${out.length.toLocaleString()})`);
}
await fs.writeFile(path.join(outDir, `${SLUG}_buildings_points.json`), JSON.stringify({ source: '국토교통부·브이월드 GIS건물통합정보 LT_C_BLDGINFO', fields: ['lon', 'lat', 'useapr_day', 'usability', 'grnd_flr', 'bld_nm', 'sig'], rows: out }), 'utf8');
console.log('완료', out.length);
