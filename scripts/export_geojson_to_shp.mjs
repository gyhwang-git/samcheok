import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = path.join(projectDir, 'data', 'raw', 'samcheok_gis_buildings.geojson');
const outBase = path.join(projectDir, 'data', 'processed', 'samcheok_gis_buildings');
const data = JSON.parse(await fs.readFile(inputPath, 'utf8'));
const dateRef = new Date('2026-11-04T00:00:00Z');

const fields = [
  { name: 'bld_nm', type: 'C', width: 180, source: 'bld_nm' },
  { name: 'dong_nm', type: 'C', width: 80, source: 'dong_nm' },
  { name: 'usability', type: 'C', width: 8, source: 'usability' },
  { name: 'grnd_flr', type: 'N', width: 6, decimals: 0, source: 'grnd_flr' },
  { name: 'ugrnd_flr', type: 'N', width: 6, decimals: 0, source: 'ugrnd_flr' },
  { name: 'archarea', type: 'N', width: 18, decimals: 2, source: 'archarea' },
  { name: 'height', type: 'N', width: 12, decimals: 2, source: 'height' },
  { name: 'vl_rat', type: 'N', width: 12, decimals: 2, source: 'vl_rat' },
  { name: 'bc_rat', type: 'N', width: 12, decimals: 2, source: 'bc_rat' },
  { name: 'totalarea', type: 'N', width: 18, decimals: 2, source: 'totalarea' },
  { name: 'platarea', type: 'N', width: 18, decimals: 2, source: 'platarea' },
  { name: 'useapr_day', type: 'C', width: 8, source: 'useapr_day' },
  { name: 'strct_cd', type: 'C', width: 8, source: 'strct_cd' },
  { name: 'sig_cd', type: 'C', width: 5, derived: 'sig_cd' },
  { name: 'age_years', type: 'N', width: 4, decimals: 0, derived: 'age' },
  { name: 'age_group', type: 'C', width: 8, derived: 'group' },
];

function getAge(dateText) {
  const s = String(dateText ?? '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(s)) return null;
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  if (year < 1800) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day || d > dateRef) return null;
  let age = dateRef.getUTCFullYear() - year;
  if (dateRef.getUTCMonth() < month - 1 || (dateRef.getUTCMonth() === month - 1 && dateRef.getUTCDate() < day)) age--;
  return age;
}

function ageGroup(age) {
  if (age == null) return '';
  if (age >= 100) return '100+';
  const low = Math.floor(age / 10) * 10;
  return `${low}-${low + 9}`;
}

function ringsFor(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.map((ring, index) => ({ ring, isOuter: index === 0 }));
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flatMap((polygon) => polygon.map((ring, index) => ({ ring, isOuter: index === 0 })));
  throw new Error(`지원하지 않는 geometry: ${geometry.type}`);
}

function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return area / 2;
}

function recordGeometry(feature) {
  const parts = ringsFor(feature.geometry).map(({ ring, isOuter }) => {
    const area = signedArea(ring);
    // ESRI polygon convention: outer rings clockwise, inner rings counter-clockwise.
    const reverse = (isOuter && area > 0) || (!isOuter && area < 0);
    return reverse ? [...ring].reverse() : ring;
  });
  const points = parts.flat();
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const contentBytes = 4 + 32 + 4 + 4 + parts.length * 4 + points.length * 16;
  const b = Buffer.alloc(contentBytes);
  b.writeInt32LE(5, 0);
  b.writeDoubleLE(Math.min(...xs), 4);
  b.writeDoubleLE(Math.min(...ys), 12);
  b.writeDoubleLE(Math.max(...xs), 20);
  b.writeDoubleLE(Math.max(...ys), 28);
  b.writeInt32LE(parts.length, 36);
  b.writeInt32LE(points.length, 40);
  let pointStart = 0;
  let partOffset = 44;
  for (const ring of parts) {
    b.writeInt32LE(pointStart, partOffset);
    pointStart += ring.length;
    partOffset += 4;
  }
  let coordOffset = 44 + parts.length * 4;
  for (const point of points) {
    b.writeDoubleLE(point[0], coordOffset);
    b.writeDoubleLE(point[1], coordOffset + 8);
    coordOffset += 16;
  }
  return { bytes: b, points };
}

function makeShpHeader(fileBytes, bbox) {
  const h = Buffer.alloc(100);
  h.writeInt32BE(9994, 0);
  h.writeInt32BE(fileBytes / 2, 24);
  h.writeInt32LE(1000, 28);
  h.writeInt32LE(5, 32);
  h.writeDoubleLE(bbox[0], 36);
  h.writeDoubleLE(bbox[1], 44);
  h.writeDoubleLE(bbox[2], 52);
  h.writeDoubleLE(bbox[3], 60);
  h.writeDoubleLE(0, 68);
  h.writeDoubleLE(0, 76);
  h.writeDoubleLE(0, 84);
  h.writeDoubleLE(0, 92);
  return h;
}

function makeDbfValue(field, feature) {
  const p = feature.properties || {};
  if (field.derived === 'sig_cd') return '51230';
  if (field.derived === 'age') {
    const age = getAge(p.useapr_day);
    return age == null ? '' : String(age);
  }
  if (field.derived === 'group') return ageGroup(getAge(p.useapr_day));
  return String(p[field.source] ?? '').trim();
}

function makeDbf(features) {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, f) => sum + f.width, 0);
  const file = Buffer.alloc(headerLength + recordLength * features.length + 1, 0);
  file[0] = 0x03;
  file[1] = 126; // 2026
  file[2] = 11;
  file[3] = 4;
  file.writeUInt32LE(features.length, 4);
  file.writeUInt16LE(headerLength, 8);
  file.writeUInt16LE(recordLength, 10);
  let descriptorOffset = 32;
  for (const field of fields) {
    Buffer.from(field.name, 'ascii').copy(file, descriptorOffset, 0, 10);
    file[descriptorOffset + 11] = field.type.charCodeAt(0);
    file[descriptorOffset + 16] = field.width;
    file[descriptorOffset + 17] = field.decimals || 0;
    descriptorOffset += 32;
  }
  file[headerLength - 1] = 0x0d;
  let rowOffset = headerLength;
  for (const feature of features) {
    file[rowOffset] = 0x20;
    rowOffset++;
    for (const field of fields) {
      let value = makeDbfValue(field, feature);
      let bytes;
      if (field.type === 'N') {
        const number = value === '' ? NaN : Number(value);
        value = Number.isFinite(number) ? (field.decimals ? number.toFixed(field.decimals) : String(Math.round(number))) : '';
        bytes = Buffer.from(value, 'ascii');
        const start = rowOffset + field.width - bytes.length;
        bytes.copy(file, start);
      } else {
        bytes = Buffer.from(value, 'utf8');
        if (bytes.length > field.width) {
          let end = field.width;
          while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
          bytes = bytes.subarray(0, end);
        }
        bytes.copy(file, rowOffset, 0, Math.min(bytes.length, field.width));
      }
      rowOffset += field.width;
    }
  }
  file[file.length - 1] = 0x1a;
  return file;
}

if (!data.features?.length) throw new Error('입력 GeoJSON에 feature가 없습니다.');
const shpRecords = data.features.map((feature) => recordGeometry(feature));
let bbox = [Infinity, Infinity, -Infinity, -Infinity];
for (const record of shpRecords) for (const point of record.points) {
  if (point[0] < bbox[0]) bbox[0] = point[0];
  if (point[1] < bbox[1]) bbox[1] = point[1];
  if (point[0] > bbox[2]) bbox[2] = point[0];
  if (point[1] > bbox[3]) bbox[3] = point[1];
}
let shpBytes = 100;
for (const r of shpRecords) shpBytes += 8 + r.bytes.length;
const shxBytes = 100 + shpRecords.length * 8;
const shp = Buffer.alloc(shpBytes);
const shx = Buffer.alloc(shxBytes);
makeShpHeader(shpBytes, bbox).copy(shp, 0);
makeShpHeader(shxBytes, bbox).copy(shx, 0);
let shpOffset = 100;
let offsetWords = 50;
for (let i = 0; i < shpRecords.length; i++) {
  const content = shpRecords[i].bytes;
  const contentWords = content.length / 2;
  shp.writeInt32BE(i + 1, shpOffset);
  shp.writeInt32BE(contentWords, shpOffset + 4);
  content.copy(shp, shpOffset + 8);
  shx.writeInt32BE(offsetWords, 100 + i * 8);
  shx.writeInt32BE(contentWords, 104 + i * 8);
  shpOffset += 8 + content.length;
  offsetWords += 4 + contentWords;
}

await fs.mkdir(path.dirname(outBase), { recursive: true });
await fs.writeFile(`${outBase}.shp`, shp);
await fs.writeFile(`${outBase}.shx`, shx);
await fs.writeFile(`${outBase}.dbf`, makeDbf(data.features));
await fs.writeFile(`${outBase}.prj`, 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]');
await fs.writeFile(`${outBase}.cpg`, 'UTF-8');
console.log(`Shapefile 작성 완료: ${data.features.length.toLocaleString('ko-KR')}건, EPSG:4326`);
