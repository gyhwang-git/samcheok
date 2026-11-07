// 추가 도시 설정(전주·태안·순천·광주). 시기 경계는 KOSIS 주민등록인구(DT_1B040A3) 추이의 전환점.
// 연표에는 널리 알려진 행정 변화만 적고, 인구 증감·증감 상위 지역은 create_city.mjs 가 데이터로 자동 추가한다.
import fs from 'node:fs/promises';
import path from 'node:path';

const unitLoader = (slug) => async (dir) => ({
  units: JSON.parse(await fs.readFile(path.join(dir, `${slug}_units.geojson`), 'utf8')),
  pop: JSON.parse(await fs.readFile(path.join(dir, `${slug}_population.json`), 'utf8')),
});
const C = ['#1f5f86', '#3a8bb0', '#6aa8c9'];

export const MORE_CITIES = {
  gwangju: {
    slug: 'gwangju', name: '광주광역시', short: '광주', split: '2002년·2014년', eyebrow: 'Gwangju · Urban spatial change', unitLabel: '구',
    structOpts: { peakR: 12, maxCenters: 16, catchM: 2000, levelRatio: 0.2, regionalM: 5000 },
    periods: [
      { key: 'q1', label: '1기', range: '1986–2002', title: '고속 성장기', start: 1986, end: 2002, color: C[0], popFrom: 1992, popTo: 2002, unitFrom: 1995, unitTo: 2002 },
      { key: 'q2', label: '2기', range: '2003–2014', title: '성장 둔화·정점기', start: 2003, end: 2014, color: C[1], popFrom: 2002, popTo: 2014, unitFrom: 2002, unitTo: 2014 },
      { key: 'q3', label: '3기', range: '2015–현재', title: '감소 전환·가속기', start: 2015, end: 9999, color: C[2], popFrom: 2014, popTo: 2025, unitFrom: 2014, unitTo: 2025 },
    ],
    timeline: { q1: [['1986', '광주직할시 승격 (전라남도에서 분리)'], ['1988', '광산군 편입 (광산구)'], ['1995', '광주광역시로 명칭 변경']], q2: [], q3: [] },
    regions: [
      { key: 'core', label: '원도심(동구)', color: '#1f5f86', units: ['12210'] },
      { key: 'old', label: '서구·남구', color: '#a8a29e', units: ['12240', '12270'] },
      { key: 'north', label: '북구', color: '#c2410c', units: ['12300'] },
      { key: 'gs', label: '광산구', color: '#15803d', units: ['12330'] },
    ],
    basis: '광주 주민등록인구는 1992~2002년 연평균 약 1.7만 명 늘다가, 2002~2014년에는 연평균 약 6,500명으로 증가가 둔화해 2014년(1,475,884명) 정점에 이르렀습니다. 이후 2014~2025년 연평균 약 7,600명씩 줄었고, 2019년 이후 감소폭이 커졌습니다. 그래서 2002년과 2014년을 기점으로 나눴습니다. 1기 시작은 직할시 승격(1986)입니다.',
    regionText: '원도심=동구, 서구·남구, 북구, 광산구.',
    limits: '구 인구는 1995년부터 있어 1기는 1995→2002 변화로 표시합니다. 구 경계는 현재 기준입니다.',
    async load(dir) {
      const pop = JSON.parse(await fs.readFile(path.join(dir, 'gwangju_population.json'), 'utf8'));
      const sigg = JSON.parse(await fs.readFile(path.join(dir, 'gwangju_sigg.geojson'), 'utf8'));
      return { units: { type: 'FeatureCollection', features: sigg.features.map((f) => ({ ...f, properties: { cd: f.properties.sig_cd, name: f.properties.sig_kor_nm } })) }, pop };
    },
  },
  jeonju: {
    slug: 'jeonju', name: '전주시', short: '전주', split: '2002년·2020년', eyebrow: 'Jeonju · Urban spatial change', unitLabel: '읍면동', unitSimplify: 0.0003,
    structOpts: { peakR: 10, maxCenters: 12, catchM: 2000, levelRatio: 0.35, regionalM: 4000 },
    periods: [
      { key: 'q1', label: '1기', range: '1970–2002', title: '성장기', start: 1970, end: 2002, color: C[0], popFrom: 1992, popTo: 2002 },
      { key: 'q2', label: '2기', range: '2003–2020', title: '완만한 성장·정점기', start: 2003, end: 2020, color: C[1], popFrom: 2002, popTo: 2020, unitFrom: 2015, unitTo: 2020 },
      { key: 'q3', label: '3기', range: '2021–현재', title: '감소 전환기', start: 2021, end: 9999, color: C[2], popFrom: 2020, popTo: 2025, unitFrom: 2020, unitTo: 2024 },
    ],
    timeline: { q1: [['1989', '완산구·덕진구 설치']], q2: [], q3: [] },
    regions: [
      { key: 'core', label: '원도심(중앙·풍남·노송·완산·동서학·서서학)', color: '#1f5f86', units: ['중앙동', '풍남동', '노송동', '완산동', '동서학동', '서서학동'] },
      { key: 'new', label: '신시가지(서신·효자4·효자5·혁신·송천2)', color: '#15803d', units: ['서신동', '효자4동', '효자5동', '혁신동', '송천2동'] },
      { key: 'ws', label: '완산구 기타', color: '#a8a29e', units: ['중화산1동', '중화산2동', '평화1동', '평화2동', '삼천1동', '삼천2동', '삼천3동', '효자1동', '효자2동', '효자3동'] },
      { key: 'dj', label: '덕진구 기타', color: '#c2410c', units: [], rest: true },
    ],
    basis: '전주 주민등록인구는 1992~2002년 연평균 약 8,600명 늘었고, 2002~2020년에는 연평균 약 1,800명으로 완만하게 늘어 2020년(657,432명) 정점에 이르렀습니다. 2020~2025년에는 연평균 약 6,400명씩 빠르게 줄어, 2002년과 2020년을 기점으로 나눴습니다. 1기 시작(1970)은 건물 자료 구분을 위한 기준입니다.',
    regionText: '원도심=중앙·풍남·노송·완산·동서학·서서학, 신시가지=서신·효자4·효자5·혁신·송천2, 그 밖은 완산구·덕진구 기타.',
    limits: '읍면동 인구는 SGIS에서 2015년부터 제공되어 2기(2015→2020)·3기(2020→2024)만 표시합니다. 읍면동 경계는 2024년 기준입니다.',
    load: unitLoader('jeonju'),
  },
  suncheon: {
    slug: 'suncheon', name: '순천시', short: '순천', split: '2001년·2020년', eyebrow: 'Suncheon · Urban spatial change', unitLabel: '읍면동', unitSimplify: 0.0003,
    periods: [
      { key: 'q1', label: '1기', range: '1970–2001', title: '도농통합·성장기', start: 1970, end: 2001, color: C[0], popFrom: 1995, popTo: 2001 },
      { key: 'q2', label: '2기', range: '2002–2020', title: '정체 후 신시가지 성장기', start: 2002, end: 2020, color: C[1], popFrom: 2001, popTo: 2020, unitFrom: 2015, unitTo: 2020 },
      { key: 'q3', label: '3기', range: '2021–현재', title: '감소 전환기', start: 2021, end: 9999, color: C[2], popFrom: 2020, popTo: 2025, unitFrom: 2020, unitTo: 2024 },
    ],
    timeline: { q1: [['1995', '순천시·승주군 통합']], q2: [], q3: [] },
    regions: [
      { key: 'core', label: '원도심(향동·중앙·장천·남제·저전)', color: '#1f5f86', units: ['향동', '중앙동', '장천동', '남제동', '저전동'] },
      { key: 'new', label: '신시가지(왕조1·왕조2·해룡면)', color: '#15803d', units: ['왕조1동', '왕조2동', '해룡면'] },
      { key: 'dong', label: '기타 동', color: '#a8a29e', units: ['매곡동', '삼산동', '조곡동', '덕연동', '풍덕동', '도사동'] },
      { key: 'rural', label: '읍면', color: '#c2410c', units: [], rest: true },
    ],
    basis: '순천은 1995년 승주군과 통합해 주민등록인구가 25만 명대가 되었습니다. 통합 후 2001년까지 늘다가 2001~2009년에는 27만 명 안팎에서 정체했고, 2010년 이후 다시 늘어 2020년(282,189명) 정점에 이르렀습니다. 2020~2025년에는 연평균 약 1,300명씩 줄어, 2001년과 2020년을 기점으로 나눴습니다.',
    regionText: '원도심=향동·중앙·장천·남제·저전, 신시가지=왕조1·왕조2·해룡면, 기타 동, 나머지 읍면.',
    limits: '1992~1994년 KOSIS 인구는 통합 전 구 순천시만의 값이라 1기 인구 변화는 통합 후인 1995년부터 계산합니다. 읍면동 인구는 SGIS에서 2015년부터 제공되어 2기(2015→2020)·3기(2020→2024)만 표시합니다.',
    load: unitLoader('suncheon'),
  },
  taean: {
    slug: 'taean', name: '태안군', short: '태안', split: '2003년·2017년', eyebrow: 'Taean · Urban spatial change', unitLabel: '읍면', unitSimplify: 0.0003,
    thresholds: { housing: 1.2, industry: 0.4, newArea: 0.8 },
    periods: [
      { key: 'q1', label: '1기', range: '1970–2003', title: '인구 급감기', start: 1970, end: 2003, color: C[0], popFrom: 1992, popTo: 2003 },
      { key: 'q2', label: '2기', range: '2004–2017', title: '정체기', start: 2004, end: 2017, color: C[1], popFrom: 2003, popTo: 2017, unitFrom: 2015, unitTo: 2017 },
      { key: 'q3', label: '3기', range: '2018–현재', title: '재감소기', start: 2018, end: 9999, color: C[2], popFrom: 2017, popTo: 2025, unitFrom: 2017, unitTo: 2024 },
    ],
    timeline: { q1: [['1989', '서산군에서 태안군 분리']], q2: [['2007', '허베이 스피리트호 원유 유출 사고']], q3: [] },
    regions: [
      { key: 'core', label: '태안읍(군 중심)', color: '#1f5f86', units: ['태안읍'] },
      { key: 'an', label: '안면읍', color: '#15803d', units: ['안면읍'] },
      { key: 'nw', label: '북서부 면(원북·이원·소원)', color: '#a8a29e', units: ['원북면', '이원면', '소원면'] },
      { key: 's', label: '남부 면(근흥·남·고남)', color: '#c2410c', units: ['근흥면', '남면', '고남면'] },
    ],
    basis: '태안 주민등록인구는 1992~2003년 연평균 약 1,300명씩 줄었고(77,909 → 63,930명), 2003~2017년에는 6.3만 명 안팎에서 정체했습니다. 2017~2025년 다시 연평균 약 560명씩 줄어, 2003년과 2017년을 기점으로 나눴습니다.',
    regionText: '태안읍, 안면읍, 북서부 면=원북·이원·소원, 남부 면=근흥·남·고남.',
    limits: '읍면 인구는 SGIS에서 2015년부터 제공되어 2기는 2015→2017, 3기는 2017→2024 변화로 표시합니다.',
    load: unitLoader('taean'),
  },
};
