# TODO перед релизом MVP

## Архитектура трекера (приоритет 1)
- [ ] Реализовать "запись только на target URLs" (DECISIONS 2026-05-08)
- [ ] Sampling mousemoves в rrweb-config: 50ms → 100-200ms
- [ ] Hard limit 30k events per session (drop overflow в трекере)
- [ ] Замер S3 объёма на nolim.cc через 1-2 недели работы

## Pre-processor (этап 6.3, приоритет 2)
- [ ] Cherry-pick 6.3a из backup/6.3a-scaffold
- [ ] Smoke test extractSessionSummary на реальной сессии nolim.cc
- [ ] 6.3b: clicks + rage/dead heuristics (DOM-id-map + tagName + 
  significant attrs)
- [ ] 6.3c: form interactions
- [ ] 6.3d: интеграция в analysis-runner (replace mock-session-data)

## Безопасность
- [ ] Ротация tracking token nolim.cc (засветился в чате 7 мая)
- [ ] Пересоздать удалённые YC cron triggers (parameters в DECISIONS 
  2026-05-07)
- [ ] Аудит утечек secrets в чатах (PG password 2x, CRON_SECRET 2x)

## Документация
- [ ] DECISIONS.md полная запись за 2026-05-07 (длинный день: 
  ротация secrets, OpenRouter migration, demo cleanup, sites 
  onboarding, ASCII validation)
