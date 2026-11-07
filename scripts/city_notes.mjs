// 도시별 지도 주석(삼척 '도시형태3'의 지도 주석과 같은 형식).
// 위치와 수치는 분석 결과(R)에서 계산한다. src: KOSIS(인구) · 건물(GIS건물통합정보) · 일반(널리 알려진 행정 변화)
// kind: core(중심 핵) · shrink(축소) · grow(성장·집중) · arrow(이동·확산) · marker(지점) · edge(행정 변화)

const pct = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
const n = (v) => Math.round(v).toLocaleString('ko-KR');

export function busanNotes(R) {
  const D = (cd) => R.districts.find((d) => d.cd === cd), P = (k) => R.periods[k];
  const nw = (k, cd) => P(k).uNew[cd] ?? { n: 0, at: D(cd).at, ind: 0, indAt: null, five: 0 };
  const chg = (k, cd) => P(k).dpop?.[cd]?.chg;
  const core = ['26110', '26140', '26170', '26200'];
  const mid = (cds) => [cds.reduce((s, c) => s + D(c).at[0], 0) / cds.length, cds.reduce((s, c) => s + D(c).at[1], 0) / cds.length];
  const share = (k, i) => { const r = P(k).reg, t = r.reduce((a, b) => a + b, 0); return ((r[i] / t) * 100).toFixed(1) + '%'; };
  const top = (k, f) => Object.entries(P(k).uNew).sort((a, b) => f(b[1]) - f(a[1])).map(([cd, o]) => ({ cd, ...o, name: D(cd).name }));
  const groupChg = (k, cds) => { const a = cds.reduce((s, c) => s + P(k).dpop[c].from, 0), b = cds.reduce((s, c) => s + P(k).dpop[c].to, 0); return ((b - a) / a) * 100; };
  const shrinkOut = (k, m) => R.districts.filter((d) => !core.includes(d.cd) && chg(k, d.cd) != null).sort((a, b) => chg(k, a.cd) - chg(k, b.cd)).slice(0, m);
  const q1top = top('q1', (o) => o.n), q1ind = top('q1', (o) => o.ind)[0], q2five = top('q2', (o) => o.five), q3five = top('q3', (o) => o.five);
  const hdRank = q2five.findIndex((o) => o.cd === '26350') + 1;
  return {
    q1: [
      { kind: 'core', at: mid(core), r: 2600, title: '원도심 — 항만·행정 중심', text: `중·서·동·영도. 1기 신축 ${n(P('q1').reg[0])}동(${share('q1', 0)})이 원도심 4구에 들어섰습니다.`, src: '건물', ref: '1기 지역 분포' },
      { kind: 'core', at: nw('q1', '26230').at, r: 1800, title: '부산진(서면) — 기성 시가지 중심', text: `1기 5층 이상 신축이 가장 많은 구(${n(nw('q1', '26230').five)}동), 신축 ${n(nw('q1', '26230').n)}동.`, src: '건물', ref: '1기 구별 신축' },
      { kind: 'arrow', from: mid(core), to: nw('q1', '26410').at, title: '시가지 북쪽 확산', text: `1기 신축 상위 구: ${q1top.slice(0, 4).map((o) => o.name + ' ' + n(o.n) + '동').join(', ')}.`, src: '건물', ref: '1기 구별 신축' },
      { kind: 'arrow', from: mid(core), to: nw('q1', '26380').at, title: '시가지 서남쪽 확산', text: `사하구가 1기 신축 최다(${n(nw('q1', '26380').n)}동)입니다.`, src: '건물', ref: '1기 구별 신축' },
      { kind: 'marker', at: q1ind.indAt, title: `${q1ind.name} 공업지역`, text: `1기 산업 건물(공장·창고 등) 최다: ${q1ind.name} ${n(q1ind.ind)}동.`, src: '건물', ref: '1기 산업 건물' },
      { kind: 'edge', at: D('26440').at, title: '1989 강서구 신설', text: '김해군 일부가 편입되어 강서구가 생겼고, 이후 서부산 개발의 터가 됩니다.', src: '일반', ref: '행정 변화' },
      { kind: 'edge', at: D('26710').at, title: '1995 기장군 편입', text: '광역시 승격과 함께 기장군이 편입되었습니다.', src: '일반', ref: '행정 변화' },
    ],
    q2: [
      { kind: 'shrink', at: mid(core), r: 2600, title: '원도심 4구 — 급감', text: `1995→2015 인구 ${pct(groupChg('q2', core))} (동구 ${pct(chg('q2', '26170'))}, 영도구 ${pct(chg('q2', '26200'))}).`, src: 'KOSIS', ref: '구·군 인구' },
      { kind: 'grow', at: nw('q2', '26350').at, r: 1600, title: '해운대 신시가지 — 성장', text: `해운대구 인구 ${pct(chg('q2', '26350'))}. 2기 5층 이상 신축 ${n(nw('q2', '26350').five)}동(구 중 ${hdRank}위).`, src: 'KOSIS·건물', ref: '구·군 인구·신축' },
      { kind: 'grow', at: nw('q2', '26710').at, r: 2400, title: '기장(정관 등) — 성장', text: `기장군 인구 ${pct(chg('q2', '26710'))}, 신축 ${n(nw('q2', '26710').n)}동.`, src: 'KOSIS·건물', ref: '구·군 인구·신축' },
      { kind: 'grow', at: nw('q2', '26440').at, r: 3000, title: '강서 — 산업·신시가지 개발', text: `강서구 인구 ${pct(chg('q2', '26440'))}. 2기 신축 최다(${n(nw('q2', '26440').n)}동), 그중 산업 건물 ${n(nw('q2', '26440').ind)}동.`, src: 'KOSIS·건물', ref: '구·군 인구·신축' },
      { kind: 'arrow', from: mid(core), to: nw('q2', '26350').at, title: '동부산으로 이동', text: '원도심이 줄고 해운대·기장이 늘어 인구 중심이 동쪽으로 옮겨갔습니다.', src: 'KOSIS', ref: '구·군 인구' },
      ...shrinkOut('q2', 2).map((d) => ({ kind: 'shrink', at: d.at, r: 1500, title: `${d.name} — 감소`, text: `원도심 밖 감소폭 상위: 인구 ${pct(chg('q2', d.cd))}.`, src: 'KOSIS', ref: '구·군 인구' })),
    ],
    q3: [
      { kind: 'grow', at: nw('q3', '26440').at, r: 2600, title: '강서(명지 등) — 집중', text: `강서구 인구 ${pct(chg('q3', '26440'))}로 가장 크게 증가, 3기 신축도 최다(${n(nw('q3', '26440').n)}동).`, src: 'KOSIS·건물', ref: '구·군 인구·신축' },
      { kind: 'grow', at: nw('q3', '26710').at, r: 2000, title: '기장 — 증가 둔화', text: `기장군 인구 ${pct(chg('q3', '26710'))} (2기 ${pct(chg('q2', '26710'))}).`, src: 'KOSIS', ref: '구·군 인구' },
      { kind: 'shrink', at: D('26350').at, r: 2000, title: '해운대 — 감소 전환', text: `2기에 ${pct(chg('q2', '26350'))} 늘었던 해운대구가 ${pct(chg('q3', '26350'))}로 감소.`, src: 'KOSIS', ref: '구·군 인구' },
      { kind: 'shrink', at: mid(core), r: 2400, title: '원도심 4구 — 감소 지속', text: `2015→2025 인구 ${pct(groupChg('q3', core))} (영도구 ${pct(chg('q3', '26200'))}).`, src: 'KOSIS', ref: '구·군 인구' },
      { kind: 'marker', at: nw('q3', q3five[0].cd).at, title: '기성 시가지 고층 재건축', text: `3기 5층 이상 신축 상위: ${q3five.slice(0, 3).map((o) => o.name + ' ' + n(o.five) + '동').join(', ')}. 부산진구 인구는 2021→2025 +3.5% 재증가.`, src: '건물·KOSIS', ref: '3기 신축·구 인구' },
      { kind: 'arrow', from: D('26230').at, to: nw('q3', '26440').at, title: '서부산으로 이동', text: '감소가 빨라진 가운데 신축과 인구 증가는 강서로 모였습니다.', src: 'KOSIS·건물', ref: '구·군 인구·신축' },
    ],
  };
}
