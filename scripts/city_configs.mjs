// 도시별 분석 설정. 시기 경계는 주민등록인구(KOSIS DT_1B040A3)의 전환점으로 정했다(삼척 도시형태3 기준과 같은 방식).
import fs from 'node:fs/promises';
import path from 'node:path';

export const CITIES = {
  busan: {
    slug: 'busan', name: '부산광역시', short: '부산', eyebrow: 'Busan · Urban spatial change', unitLabel: '구·군',
    periods: [
      { key: 'q1', label: '1기', range: '1963–1995', title: '성장·정점기', start: 1963, end: 1995, color: '#1f5f86', popFrom: 1992, popTo: 1995 },
      { key: 'q2', label: '2기', range: '1996–2015', title: '감소·외곽 확산기', start: 1996, end: 2015, color: '#3a8bb0', popFrom: 1995, popTo: 2015, unitFrom: 1995, unitTo: 2015 },
      { key: 'q3', label: '3기', range: '2016–현재', title: '감소 가속·신도시 집중기', start: 2016, end: 9999, color: '#6aa8c9', popFrom: 2015, popTo: 2025, unitFrom: 2015, unitTo: 2025 },
    ],
    timeline: {
      q1: [['1963', '부산시가 정부 직할시로 승격 (경상남도에서 분리)'], ['1989', '강서구 신설 (김해군 일부 편입)'], ['1995', '부산광역시로 명칭 변경, 기장군 편입'], ['1992~1995', '주민등록인구 388만 명대 정점 (1995년 3,883,880명)']],
      q2: [['1995~2000', '해운대구 인구 30.5만 → 40.9만 명 (해운대 신시가지 입주)'], ['1995~2015', '원도심 4구(중·서·동·영도) 인구 −36.9%'], ['2009~2015', '기장군·강서구 인구 반등 (정관·명지 등 신시가지)'], ['1995~2015', '부산 인구 −37.0만 명 (−9.5%)']],
      q3: [['2015~2025', '부산 인구 −27.2만 명 (−7.7%), 연평균 감소폭 확대'], ['2015~2025', '강서구 인구 9.5만 → 15.0만 명 (+58.9%)'], ['2015~2025', '해운대구 인구 −11.9%, 원도심 4구 −15.5%'], ['2021~2025', '부산진구 인구 35.3만 → 36.5만 명 재증가']],
    },
    regions: [
      { key: 'core', label: '원도심(중·서·동·영도)', color: '#1f5f86', units: ['26110', '26140', '26170', '26200'] },
      { key: 'old', label: '기성 시가지', color: '#a8a29e', units: [], rest: true },
      { key: 'east', label: '동부산(해운대·기장)', color: '#c2410c', units: ['26350', '26710'] },
      { key: 'west', label: '서부산(강서)', color: '#15803d', units: ['26440'] },
    ],
    basis: '부산 주민등록인구는 1995년(3,883,880명)이 정점이고, 1995~2015년에는 연평균 약 1.9만 명, 2015~2025년에는 연평균 약 2.7만 명씩 줄어 2015년을 감소 가속의 기점으로 보았습니다. 1기 시작은 직할시 승격(1963)입니다.',
    regionText: '원도심=중·서·동·영도, 동부산=해운대·기장, 서부산=강서, 그 밖은 기성 시가지.',
    limits: '구·군 경계는 현재 기준이며, 강서구(1989)·기장군(1995) 편입 전 시기도 같은 경계로 집계했습니다. 구·군 인구는 1995년부터 있어 1기는 표시하지 않습니다.',
    async load(dir) {
      const pop = JSON.parse(await fs.readFile(path.join(dir, 'busan_population_kosis.json'), 'utf8'));
      const sigg = JSON.parse(await fs.readFile(path.join(dir, 'busan_sigg.geojson'), 'utf8'));
      return { units: { type: 'FeatureCollection', features: sigg.features.map((f) => ({ ...f, properties: { cd: f.properties.sig_cd, name: f.properties.sig_kor_nm } })) }, pop: { total: pop.total, source: pop.source, note: pop.note, unitYears: pop.years, units: pop.districts } };
    },
  },
  yeosu: {
    slug: 'yeosu', name: '여수시', short: '여수', eyebrow: 'Yeosu · Urban spatial change', unitLabel: '읍면동', unitSimplify: 0.0003,
    fitBox: [127.56, 34.6, 127.8, 34.92], // 첫 화면: 시가지·돌산·화양 (삼산면 거문도 등 먼 섬 제외)
    thresholds: { housing: 1.5, industry: 0.5, newArea: 1.0 },
    periods: [
      { key: 'q1', label: '1기', range: '1970–1997', title: '산업도시 형성기(통합 전)', start: 1970, end: 1997, color: '#1f5f86', popFrom: 1992, popTo: 1997 },
      { key: 'q2', label: '2기', range: '1998–2009', title: '통합 후 감소기', start: 1998, end: 2009, color: '#3a8bb0', popFrom: 1998, popTo: 2009 },
      { key: 'q3', label: '3기', range: '2010–현재', title: '정체 후 재감소·신시가지 집중기', start: 2010, end: 9999, color: '#6aa8c9', popFrom: 2009, popTo: 2025, unitFrom: 2015, unitTo: 2024 },
    ],
    timeline: {
      q1: [['1970년대~', '여천 석유화학단지(현 여수국가산업단지) 조성·확장'], ['1992~1997', '현 시역 인구 33.3만 → 33.0만 명 (통합 전 여수시·여천시·여천군 합계)'], ['1992~1997', '여천시 7.4만 → 8.1만 명 증가, 여천군 7.4만 → 6.1만 명 감소']],
      q2: [['1998', '여수시·여천시·여천군 통합'], ['1998~2009', '인구 32.9만 → 29.4만 명 (−10.9%, 연평균 약 3,300명 감소)']],
      q3: [['2009~2015', '인구 29.4만 → 29.0만 명, 감소 둔화(정체)'], ['2012', '여수세계박람회 개최'], ['2015~2025', '인구 29.0만 → 26.3만 명 (−9.3%), 감소 재가속'], ['2015~2024', '시전동 인구 2.6만 → 4.3만 명 (+61.6%, 웅천 등 신시가지), 구도심 동 대부분 감소']],
    },
    regions: [
      { key: 'core', label: '구 여수 원도심', color: '#1f5f86', units: ['동문동', '한려동', '중앙동', '충무동', '광림동', '서강동', '대교동', '국동', '월호동'] },
      { key: 'ysnew', label: '구 여수 주거지(여서·문수·미평·둔덕·만덕)', color: '#a8a29e', units: ['여서동', '문수동', '미평동', '둔덕동', '만덕동'] },
      { key: 'yc', label: '구 여천시(쌍봉·시전·여천·주삼·삼일·묘도)', color: '#c2410c', units: ['쌍봉동', '시전동', '여천동', '주삼동', '삼일동', '묘도동'] },
      { key: 'rural', label: '읍면(구 여천군)', color: '#15803d', units: ['돌산읍', '소라면', '율촌면', '화양면', '남면', '화정면', '삼산면'] },
    ],
    basis: '여수시는 1998년 여수시·여천시·여천군이 통합된 도시입니다. 통합 후 주민등록인구는 2009년까지 연평균 약 3,300명 줄었고, 2009~2015년에는 연평균 약 560명으로 감소가 둔화(정체)했다가 2015~2025년 다시 연평균 약 2,700명씩 줄었습니다. 그래서 통합(1998)과 정체가 시작된 2010년을 기점으로 나눴습니다. 1기 시작(1970)은 석유화학단지 조성 시기를 기준으로 잡은 것입니다.',
    regionText: '구 여수 원도심=동문·한려·중앙·충무·광림·서강·대교·국동·월호, 구 여수 주거지=여서·문수·미평·둔덕·만덕, 구 여천시=쌍봉·시전·여천·주삼·삼일·묘도, 읍면=돌산·소라·율촌·화양·남·화정·삼산.',
    limits: '1992~1997년 인구는 통합 전 세 시·군의 합계로 현 시역을 근사했습니다. 읍면동 인구는 SGIS에서 2015년부터 제공되어 3기(2015→2024)에만 표시합니다. 읍면동 경계는 2024년 기준입니다.',
    async load(dir) {
      const pop = JSON.parse(await fs.readFile(path.join(dir, 'yeosu_population.json'), 'utf8'));
      const units = JSON.parse(await fs.readFile(path.join(dir, 'yeosu_units.geojson'), 'utf8'));
      return { units, pop };
    },
  },
};
export const SWITCH = [['삼척', 'building_age_preview.html'], ['부산', 'busan.html'], ['여수', 'yeosu.html']];
