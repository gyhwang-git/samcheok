// 건축물대장 주용도코드(usability) → 용도명, 지도·분석용 대분류.
// Z로 시작하는 코드는 구(舊) 용도체계 코드로 보이며 공식 명칭을 확인하지 못해 '기타'로 묶는다.

export const USE_CODES = {
  '01000': '단독주택', '02000': '공동주택', '03000': '제1종근린생활시설', '04000': '제2종근린생활시설',
  '05000': '문화및집회시설', '06000': '종교시설', '07000': '판매시설', '08000': '운수시설',
  '09000': '의료시설', '10000': '교육연구시설', '11000': '노유자시설', '12000': '수련시설',
  '13000': '운동시설', '14000': '업무시설', '15000': '숙박시설', '16000': '위락시설',
  '17000': '공장', '18000': '창고시설', '19000': '위험물저장및처리시설', '20000': '자동차관련시설',
  '21000': '동물및식물관련시설', '22000': '분뇨및쓰레기처리시설', '23000': '교정및군사시설', '24000': '방송통신시설',
  '25000': '발전시설', '26000': '묘지관련시설', '27000': '관광휴게시설', '28000': '장례식장',
  '29000': '장례시설', '30000': '자원순환관련시설', '31000': '야영장시설',
};

// 색: dataviz 기본 범주 팔레트 고정 순서(검증 통과). 기타·미상은 중립 회색.
export const USE_GROUPS = [
  { label: '단독주택', color: '#2a78d6', codes: ['01000'] },
  { label: '근린생활시설', color: '#eb6834', codes: ['03000', '04000'] },
  { label: '공장·창고·산업', color: '#1baf7a', codes: ['17000', '18000', '19000', '20000', '25000'] },
  { label: '동식물관련시설', color: '#eda100', codes: ['21000'] },
  { label: '공동주택', color: '#e87ba4', codes: ['02000'] },
  { label: '공공·교육·복지', color: '#008300', codes: ['05000', '06000', '09000', '10000', '11000', '12000', '13000', '23000', '24000'] },
  { label: '상업·업무·숙박', color: '#6250d6', codes: ['07000', '08000', '14000', '15000', '16000'] },
  { label: '기타', color: '#64748b', codes: [] }, // 환경·관광·장례·묘지·야영장·구(Z) 코드
  { label: '용도 미상', color: '#cbd5e1', codes: [] },
];
export const UNKNOWN_GROUP = USE_GROUPS.length - 1;
export const OTHER_GROUP = USE_GROUPS.length - 2;
export const AGE_BINS = ['0–19년', '20–29년', '30–39년', '40년 이상'];

const codeToGroup = new Map(USE_GROUPS.flatMap((g, i) => g.codes.map((c) => [c, i])));

export function useGroupIndex(code) {
  if (!code) return UNKNOWN_GROUP;
  return codeToGroup.get(code) ?? OTHER_GROUP;
}

export function useName(code) {
  if (!code) return '용도 미상';
  return USE_CODES[code] ?? `구 용도코드 ${code} (명칭 미확인)`;
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ageBin = (age) => (age < 20 ? 0 : age < 30 ? 1 : age < 40 ? 2 : 3);

function summarize(rows) {
  const ages = rows.map((r) => r.age).filter((a) => a != null);
  const areas = rows.map((r) => r.area).filter((a) => a != null);
  const floors = rows.map((r) => r.floors).filter((a) => a != null);
  const bins = [0, 0, 0, 0];
  for (const a of ages) bins[ageBin(a)]++;
  return {
    count: rows.length,
    dated: ages.length,
    medianAge: median(ages),
    meanAge: ages.length ? ages.reduce((s, a) => s + a, 0) / ages.length : null,
    old30: ages.filter((a) => a >= 30).length,
    areaSum: areas.reduce((s, a) => s + a, 0),
    areaN: areas.length,
    medianArea: median(areas),
    meanFloors: floors.length ? floors.reduce((s, a) => s + a, 0) / floors.length : null,
    bins,
  };
}

// rows: [{ code, age, area, floors }]
export function computeUseStats(rows) {
  const byGroup = USE_GROUPS.map(() => []);
  const byCode = new Map();
  for (const r of rows) {
    byGroup[useGroupIndex(r.code)].push(r);
    if (r.code) { if (!byCode.has(r.code)) byCode.set(r.code, []); byCode.get(r.code).push(r); }
  }
  const known = rows.filter((r) => r.code);
  return {
    total: rows.length,
    known: known.length,
    knownDated: known.filter((r) => r.age != null).length,
    groups: USE_GROUPS.map((g, i) => ({ label: g.label, color: g.color, ...summarize(byGroup[i]) })),
    codes: [...byCode.entries()]
      .map(([code, rs]) => ({ code, name: useName(code), group: useGroupIndex(code), ...summarize(rs) }))
      .sort((a, b) => b.count - a.count),
  };
}

export function rowFromProperties(p, ageFor) {
  return { code: String(p?.usability ?? '').trim(), age: ageFor(p?.useapr_day), area: num(p?.totalarea), floors: num(p?.grnd_flr) };
}

// 분석 기준일 기준 사용승인 후 경과연수 (만 나이 방식). 형식 오류·1800년 이전·기준일 이후는 null.
export const analysisDate = new Date('2026-11-04T00:00:00Z');

export function ageFor(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1800) return null;
  const date = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10).replaceAll('-', '') !== digits || date > analysisDate) return null;
  let age = analysisDate.getUTCFullYear() - year;
  if (analysisDate.getUTCMonth() < month - 1 || (analysisDate.getUTCMonth() === month - 1 && analysisDate.getUTCDate() < day)) age--;
  return age;
}
