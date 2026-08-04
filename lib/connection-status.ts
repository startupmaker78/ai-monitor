import { prisma } from "@/lib/prisma"

// Статус подключения сайта для виджета на карточке сайта. ТОЛЬКО DB-запросы,
// ни одного вызова Метрики (цели/«живость» намеренно не тащим — единственное,
// что стоило бы API-вызовов). Все запросы по индексам:
// Session[siteId,startedAt], AnalysisTarget[siteId,status], MetricsSnapshot.
export type ConnectionStatus = {
  trackerActive: boolean // трекер прислал хоть одну сессию
  activeTargets: number // активных страниц (archivedAt:null) — без них
  // should-record вернёт no_target и запись не создастся никогда
  metrikaConfigured: boolean // counterId + token заданы
  syncHasData: boolean // синк записал снапшот с visits>0 (реальные данные)
}

export async function getConnectionStatus(
  siteId: string,
): Promise<ConnectionStatus> {
  const [sessionCount, targetCount, site, snapshotWithData] = await Promise.all([
    prisma.session.count({ where: { siteId } }),
    prisma.analysisTarget.count({ where: { siteId, archivedAt: null } }),
    prisma.site.findUnique({
      where: { id: siteId },
      select: { metrikaCounterId: true, metrikaToken: true },
    }),
    prisma.metricsSnapshot.count({ where: { siteId, visits: { gt: 0 } } }),
  ])
  return {
    trackerActive: sessionCount > 0,
    activeTargets: targetCount,
    metrikaConfigured: Boolean(site?.metrikaCounterId && site?.metrikaToken),
    // visits>0, а НЕ просто наличие снапшота: у свежего счётчика 30 нулевых
    // снапшотов (hasMetrics=true врал бы). Честный сигнал — есть ли реальные
    // визиты. (См. TODO про переключение пустого состояния главной.)
    syncHasData: snapshotWithData > 0,
  }
}
