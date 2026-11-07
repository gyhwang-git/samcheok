# Samcheok

**삼척시 공간구조 변화 분석** — 건축물 사용승인연도·용도와 인구·사업체 통계로 삼척시 시가지의 형성과 축소, 중심지 이동을 시기별로 분석한 웹 지도입니다.

- 도시 비교(삼척 도시형태3 기준 3단계 분석 + 지도 주석, 삼척 공간구조도 방식의 공간구조도 탭, 페이지 상단 삼척/부산/여수 전환)
  - 부산: https://gyhwang-git.github.io/samcheok/reports/busan.html
  - 여수: https://gyhwang-git.github.io/samcheok/reports/yeosu.html
  - 광주·전주·순천·태안: reports/gwangju.html · jeonju.html · suncheon.html · taean.html
- 웹 지도: https://gyhwang-git.github.io/samcheok/ (탭: 노후도 · 건물 용도 · 감자도 · 공간구조도 · 도시형태 · 도시형태2 · 도시형태3 · 변화 유형)
- 보고서: [reports/building_age_analysis.md](reports/building_age_analysis.md), [reports/building_use_analysis.md](reports/building_use_analysis.md), [reports/urban_change_types.md](reports/urban_change_types.md)

## 자료
- 건물: 국토교통부·브이월드 GIS건물통합정보(LT_C_BLDGINFO), 행정구역코드 51230(삼척시)
- 철도: © OpenStreetMap contributors (ODbL)
- 배경지도: © OpenStreetMap contributors © CARTO (래스터 타일, .env 의 CARTO_API_KEY 사용)
- 도시형태 탭: 박훈(2020), 「삼척시 지적자료 분석을 통한 근·현대 도시형태 변화 연구」, 대한건축학회연합논문집 22(1)
- 부산·여수: 국토교통부·브이월드 GIS건물통합정보(부산 568,900동, 여수 152,129동; `node scripts/download_city.mjs <slug> <시군구코드> <검색상자>`), KOSIS 주민등록인구 [DT_1B040A3], 여수 읍면동 인구·경계는 SGIS(`node scripts/download_yeosu_stats.mjs`). 도시 설정 `scripts/city_configs.mjs`, 페이지 생성 `node scripts/create_city.mjs busan|yeosu`
- 변화 유형 탭: 통계청 SGIS 집계구 통계(인구·가구·주택·사업체·종사자), `node scripts/download_sgis.mjs`로 수집(.env 의 SGIS_CONSUMER_KEY/SECRET 필요)
- 도시형태3 탭 인구·연표: 삼척시·삼척군 통계연보, 행정안전부 주민등록인구통계(2026.6)

## 다시 만들기
```
node scripts/download_and_analyze.mjs   # 상위 폴더 .env의 V-WORLD_KEY 필요
node scripts/analyze_building_use.mjs
node scripts/create_preview.mjs         # reports/building_age_preview.html 생성
```
지도 데이터는 `reports/building_age_data.js`로 분리되어 페이지가 열린 뒤 비동기로 불러옵니다.
