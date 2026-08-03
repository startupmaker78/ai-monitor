import { prisma } from "@/lib/prisma"

// Статус подключения сайта для виджета на карточке сайта. ТОЛЬКО DB-запросы,
// ни одного вызова Метрики (цели/«живость» намеренно не тащим — единственное,
// что стоило бы API-вызовов). Все три запроса по индексам:
// Session[siteId,startedAt], MetricsSnapshot[siteId,date], Site по PK.
export type ConnectionStatus = {
  trackerActive: boolean // трекер прислал хоть одну сессию
  metrikaConfigured: boolean // counterId + token заданы
  syncHasData: boolean // синк записал снапшот с visits>0 (реальные данные)
}

export async function getConnectionStatus(
  siteId: string,
): Promise<ConnectionStatus> {
  const [sessionCount, site, snapshotWithData] = await Promise.all([
    prisma.session.count({ where: { siteId } }),
    prisma.site.findUnique({
      where: { id: siteId },
      select: { metrikaCounterId: true, metrikaToken: true },
    }),
    prisma.metricsSnapshot.count({ where: { siteId, visits: { gt: 0 } } }),
  ])
  return {
    trackerActive: sessionCount > 0,
    metrikaConfigured: Boolean(site?.metrikaCounterId && site?.metrikaToken),
    // visits>0, а НЕ просто наличие снапшота: у свежего счётчика 30 нулевых
    // снапшотов (hasMetrics=true врал бы). Честный сигнал — есть ли реальные
    // визиты. (См. TODO про переключение пустого состояния главной.)
    syncHasData: snapshotWithData > 0,
  }
}
