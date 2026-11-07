# Samcheok

삼척시 건물 노후도·용도와 도시공간구조 변화를 지도로 분석한 프로젝트입니다.

- 웹 지도: https://gyhwang-git.github.io/samcheok/ (탭: 노후도 · 건물 용도 · 감자도 · 공간구조도 · 도시형태 · 도시형태2 · 도시형태3)
- 보고서: [reports/building_age_analysis.md](reports/building_age_analysis.md), [reports/building_use_analysis.md](reports/building_use_analysis.md)

## 자료
- 건물: 국토교통부·브이월드 GIS건물통합정보(LT_C_BLDGINFO), 행정구역코드 51230(삼척시)
- 철도: © OpenStreetMap contributors (ODbL)
- 배경지도: © OpenStreetMap contributors © CARTO (래스터 타일, .env 의 CARTO_API_KEY 사용)
- 도시형태 탭: 박훈(2020), 「삼척시 지적자료 분석을 통한 근·현대 도시형태 변화 연구」, 대한건축학회연합논문집 22(1)
- 도시형태3 탭 인구·연표: 삼척시·삼척군 통계연보, 행정안전부 주민등록인구통계(2026.6)

## 다시 만들기
```
node scripts/download_and_analyze.mjs   # 상위 폴더 .env의 V-WORLD_KEY 필요
node scripts/analyze_building_use.mjs
node scripts/create_preview.mjs         # reports/building_age_preview.html 생성
```
지도 데이터는 `reports/building_age_data.js`로 분리되어 페이지가 열린 뒤 비동기로 불러옵니다.
