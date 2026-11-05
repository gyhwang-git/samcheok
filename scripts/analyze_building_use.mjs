import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeUseStats, rowFromProperties, ageFor, AGE_BINS, UNKNOWN_GROUP } from './building_use.mjs';
import { computePotato, potatoPoints } from './potato_plan.mjs';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(projectDir, 'data', 'raw', 'samcheok_gis_buildings.geojson');
const reportDir = path.join(projectDir, 'reports');
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const source = JSON.parse(await fs.readFile(dataPath, 'utf8'));
  const s = computeUseStats(source.features.map((f) => rowFromProperties(f.properties, ageFor)));
  const n = (v) => v.toLocaleString('ko-KR');
  const p = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '–');
  const yr = (v) => (v == null ? '–' : `${Math.round(v)}년`);
  const area = (v) => n(Math.round(v));
  const knownGroups = s.groups.slice(0, UNKNOWN_GROUP);

  const lines = [
    '# 삼척시 건물 용도 분석',
    '',
    '- 분석 기준일: 2026-11-04',
    '- 자료: 브이월드 GIS건물통합정보 API (LT_C_BLDGINFO)의 `usability`(건축물대장 주용도코드)',
    `- 삼척시 경계 내부 건물: ${n(s.total)}건`,
    `- 용도코드 확인: ${n(s.known)}건 (${p(s.known, s.total)}) · 용도 미상 ${n(s.total - s.known)}건 (${p(s.total - s.known, s.total)})`,
    `- 용도와 사용승인일이 모두 유효: ${n(s.knownDated)}건`,
    '',
    '> 용도 비율은 **용도코드가 있는 건물**을 분모로 합니다. 미상 건물은 대부분 건축물대장과 연계되지 않은 도형(소규모 부속·무허가·멸실 미반영 등으로 추정)이라 용도 구성이 다를 수 있습니다.',
    '',
    '## 용도 대분류',
    '',
    '| 용도 대분류 | 건물 수 | 용도 확인 대비 | 연면적 합계(㎡) | 연면적 중앙값(㎡) | 평균 지상층수 | 승인일 유효 | 중앙 연령 | 30년 이상 비율 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...knownGroups.map((g) => `| ${g.label} | ${n(g.count)} | ${p(g.count, s.known)} | ${area(g.areaSum)} | ${g.medianArea == null ? '–' : area(g.medianArea)} | ${g.meanFloors == null ? '–' : g.meanFloors.toFixed(1)} | ${n(g.dated)} | ${yr(g.medianAge)} | ${p(g.old30, g.dated)} |`),
    `| 용도 미상 | ${n(s.groups[UNKNOWN_GROUP].count)} | – | ${area(s.groups[UNKNOWN_GROUP].areaSum)} | – | – | ${n(s.groups[UNKNOWN_GROUP].dated)} | ${yr(s.groups[UNKNOWN_GROUP].medianAge)} | ${p(s.groups[UNKNOWN_GROUP].old30, s.groups[UNKNOWN_GROUP].dated)} |`,
    '',
    '## 용도별 연령 구성 (사용승인일 유효 건물)',
    '',
    `| 용도 대분류 | ${AGE_BINS.join(' | ')} |`,
    `|---|${AGE_BINS.map(() => '---:').join('|')}|`,
    ...knownGroups.filter((g) => g.dated).map((g) => `| ${g.label} | ${g.bins.map((c) => `${n(c)} (${p(c, g.dated)})`).join(' | ')} |`),
    '',
    '## 세부 용도코드',
    '',
    '| 코드 | 용도 | 건물 수 | 승인일 유효 | 중앙 연령 | 30년 이상 비율 |',
    '|---|---|---:|---:|---:|---:|',
    ...s.codes.map((c) => `| ${c.code} | ${c.name} | ${n(c.count)} | ${n(c.dated)} | ${yr(c.medianAge)} | ${p(c.old30, c.dated)} |`),
    '',
    '## 시기별 감자도 권역 면적 (누적, ha)',
    '',
    ...(() => { const pt = computePotato(potatoPoints(source.features)); return [
      `| 권역 | ${pt.eras.map((e) => e.label).join(' | ')} | 현재 전체 |`,
      `|---|${pt.eras.map(() => '---:').join('|')}|---:|`,
      ...pt.classes.map((c, ci) => `| ${c.label} | ${pt.eras.map((e) => n(pt.scenes['cum:' + e.key][ci].areaHa)).join(' | ')} | ${n(pt.scenes.all[ci].areaHa)} |`),
      '',
      `방법: 용도군별 건물 위치의 가우시안 커널 밀도(σ=${pt.method.sigmaM}m, ${pt.method.cellM}m 격자)에서 고정 임계 밀도(${pt.classes.map((c) => c.label + ' ' + c.threshold).join(', ')} 건/ha) 이상을 권역으로 추출, ${pt.method.minAreaHa}ha 미만 제외. 현존 건물의 사용승인일 기준이라 과거 시기는 멸실 건물만큼 과소 추정됩니다.`,
      '',
    ]; })(),
    '## 해석 시 유의점',
    '',
    '- 용도코드는 건축물대장의 **주용도** 하나만 담습니다. 복합용도 건물은 주용도로만 분류됩니다.',
    '- 기타에는 분뇨및쓰레기처리·자원순환·묘지·장례·관광휴게·야영장시설과 Z 코드를 묶었습니다.',
    '- `Z`로 시작하는 코드(Z3000, Z5000, Z6000, Z8000, Z9000)는 현행 주용도코드표에 없어 명칭을 확인하지 못했습니다. 건물명으로 보면 Z8000은 학교·어린이집이 많지만, 여기서는 임의로 재분류하지 않고 기타로 두었습니다.',
    '- 22000(분뇨및쓰레기처리시설)·30000(자원순환관련시설)처럼 구·신 코드가 함께 쓰입니다.',
    '- 연령 지표는 승인일이 유효한 건물에 한정됩니다.',
  ];
  await fs.writeFile(path.join(reportDir, 'building_use_analysis.md'), lines.join('\n') + '\n', 'utf8');

  const csv = ['group,count,share_of_known,area_sum_m2,dated,median_age,old30_share,age_0_19,age_20_29,age_30_39,age_40_plus',
    ...s.groups.map((g) => [g.label, g.count, g.label === '용도 미상' ? '' : (g.count / s.known).toFixed(4), Math.round(g.areaSum), g.dated, g.medianAge ?? '', g.dated ? (g.old30 / g.dated).toFixed(4) : '', ...g.bins].join(','))];
  await fs.writeFile(path.join(reportDir, 'building_use_by_group.csv'), '﻿' + csv.join('\n') + '\n', 'utf8');
  console.log(lines.slice(0, 30).join('\n'));
}
