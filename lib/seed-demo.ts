import { randomUUID, createHash } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

function fakeIpHash(seed: string): string {
  return createHash("sha256").update(seed).digest("hex")
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

const RECOMMENDATION_TEMPLATES: Array<{
  targetIndex: 0 | 1 | 2
  priority: "CRITICAL" | "IMPORTANT" | "GOOD"
  title: string
  description: string
  metric: string | null
}> = [
  {
    targetIndex: 0,
    priority: "CRITICAL",
    title: "Основной CTA не виден на мобильных без скролла",
    description:
      "На устройствах с экраном до 6\" кнопка «Начать бесплатно» оказывается ниже первого экрана. По данным rrweb-сессий, 67% мобильных посетителей не доскроллили до неё. Поднять CTA в верхний блок hero-секции, либо добавить sticky-кнопку.",
    metric: "Конверсия в регистрацию",
  },
  {
    targetIndex: 0,
    priority: "CRITICAL",
    title: "Долгая загрузка hero-изображения (LCP > 4s)",
    description:
      "Главное изображение в hero весит 1.8MB и грузится 4.2 секунды. Из 100 пользователей 23 уходят до отрисовки. Сжать через WebP, добавить loading='eager' и preload в <head>.",
    metric: "Bounce rate",
  },
  {
    targetIndex: 0,
    priority: "IMPORTANT",
    title: "Социальные доказательства слабо акцентированы",
    description:
      "Логотипы клиентов размещены в подвале серой плашкой. Из rrweb видно — на них почти никто не задерживается. Перенести в первый экран сразу под hero-блоком, добавить заголовок «Нам доверяют».",
    metric: "Доверие пользователей",
  },
  {
    targetIndex: 0,
    priority: "IMPORTANT",
    title: "Отсутствие чата для быстрых вопросов",
    description:
      "В сессиях прослеживается паттерн: пользователь читает hero → пытается найти ответ на вопрос «как именно работает» → возвращается → уходит. Нужен мини-чат или кнопка «Задать вопрос» с быстрым ответом.",
    metric: "Время на странице",
  },
  {
    targetIndex: 0,
    priority: "GOOD",
    title: "Видеоролик в hero повышает engagement",
    description:
      "В 8 из 10 рекордингов пользователи задерживались на странице дольше когда был видеоролик. Если есть промо-ролик — добавить как фоновое автозапускающееся видео без звука.",
    metric: "Время на странице",
  },
  {
    targetIndex: 0,
    priority: "GOOD",
    title: "Микроанимации усилят восприятие интерактивности",
    description:
      "Hover-эффекты на главных кнопках почти отсутствуют. Добавить лёгкое поднятие при наведении (transform: translateY(-2px)) — психологически создаст ощущение «живого» интерфейса.",
    metric: null,
  },
  {
    targetIndex: 1,
    priority: "CRITICAL",
    title: "Тарифы без сравнительной таблицы",
    description:
      "Пользователи на /pricing проводят в среднем 47 секунд и в 71% случаев уходят без выбора. Из rrweb видно — они скроллят вверх-вниз пытаясь сравнить тарифы. Добавить таблицу сравнения функций по строкам.",
    metric: "Конверсия в оплату",
  },
  {
    targetIndex: 1,
    priority: "CRITICAL",
    title: "Цена в верхнем блоке, без указания «в месяц/год»",
    description:
      "В hero на /pricing видно «4 990 ₽» без пометки периодичности. Несколько сессий показывают повторное возвращение к странице — пользователи перепроверяют. Добавить «/мес» крупно сразу под цифрой.",
    metric: "Конверсия в оплату",
  },
  {
    targetIndex: 1,
    priority: "IMPORTANT",
    title: "Кнопка «Выбрать план» одинакова на всех тарифах",
    description:
      "Рекомендуемый тариф (Стандартный) визуально не выделен. Сделать его кнопку primary (синий заполненный), у остальных — outline. Также увеличить тариф в высоту на 8-10%.",
    metric: "Распределение по тарифам",
  },
  {
    targetIndex: 1,
    priority: "IMPORTANT",
    title: "FAQ на странице оплаты отсутствует",
    description:
      "По воронке видно: 34% пришедших на /pricing уходят на /faq, 60% из них не возвращаются. Добавить блок FAQ внизу страницы тарифов: «Можно ли отменить подписку?», «Что если данных недостаточно для анализа?»",
    metric: "Конверсия в оплату",
  },
  {
    targetIndex: 1,
    priority: "GOOD",
    title: "Годовой план не имеет визуальной экономии",
    description:
      "Сейчас годовой план просто упомянут как опция. Добавить badge «Экономия 17%» рядом с переключателем месяц/год — это типовой паттерн повышения ARPU.",
    metric: "ARPU",
  },
  {
    targetIndex: 2,
    priority: "IMPORTANT",
    title: "Текст «О нас» слишком длинный, нет якорей",
    description:
      "Страница /about содержит ~1800 слов сплошным потоком. Среднее время чтения — 1:20, после которого 80% уходят. Разбить на разделы с якорями (Команда / История / Миссия), добавить навигацию по якорям сверху.",
    metric: "Время на странице",
  },
  {
    targetIndex: 2,
    priority: "IMPORTANT",
    title: "Нет призыва после прочтения «О нас»",
    description:
      "Пользователь долистал до конца страницы → закрыл вкладку. Из 100 человек только 4 переходят отсюда на /pricing. В конец /about добавить блок «Готовы попробовать?» с двумя CTA: «Бесплатная регистрация» и «Тарифы».",
    metric: "Конверсия из /about",
  },
  {
    targetIndex: 2,
    priority: "GOOD",
    title: "Фотографии команды отсутствуют",
    description:
      "Раздел «Команда» представлен только текстом. Добавить фото 3-5 ключевых сотрудников с короткими bio. Это типовой паттерн повышения доверия для B2B-продуктов.",
    metric: "Доверие пользователей",
  },
  {
    targetIndex: 2,
    priority: "GOOD",
    title: "Социальные ссылки команды могут усилить доверие",
    description:
      "Под фото команды добавить иконки LinkedIn / Twitter (по желанию сотрудников). Это создаёт ощущение «реальных людей за продуктом».",
    metric: null,
  },
]

export interface SeedDemoSiteOptions {
  siteId: string
  userId: string
}

export async function seedDemoSite({ siteId, userId }: SeedDemoSiteOptions) {
  await prisma.$transaction(async (tx) => {
    const snapshots: Prisma.MetricsSnapshotCreateManyInput[] = []
    for (let i = 29; i >= 0; i--) {
      const date = daysAgo(i)
      const baseVisits = 80 + Math.floor(((29 - i) / 29) * 70)
      const visits = baseVisits + randInt(-15, 25)
      const conversions = Math.floor(visits * (0.02 + Math.random() * 0.02))
      const uniqueVisitors = Math.floor(visits * (0.65 + Math.random() * 0.15))
      const bounceRate = parseFloat((35 + Math.random() * 30).toFixed(2))
      const avgSessionDuration = randInt(60, 300)

      snapshots.push({
        siteId,
        date,
        visits,
        uniqueVisitors,
        conversions,
        bounceRate: new Prisma.Decimal(bounceRate),
        avgSessionDuration,
        goals: {
          signup: Math.floor(conversions * 0.6),
          purchase: Math.floor(conversions * 0.4),
        },
      })
    }
    await tx.metricsSnapshot.createMany({ data: snapshots })

    const targets = await Promise.all([
      tx.analysisTarget.create({
        data: {
          siteId,
          url: "/",
          name: "Главная страница",
          sessionsBudget: 1000,
          sessionsCollected: 987,
          status: "COMPLETED",
        },
      }),
      tx.analysisTarget.create({
        data: {
          siteId,
          url: "/pricing",
          name: "Страница тарифов",
          sessionsBudget: 600,
          sessionsCollected: 523,
          status: "COMPLETED",
        },
      }),
      tx.analysisTarget.create({
        data: {
          siteId,
          url: "/about",
          name: "О компании",
          sessionsBudget: 400,
          sessionsCollected: 312,
          status: "COMPLETED",
        },
      }),
      tx.analysisTarget.create({
        data: {
          siteId,
          url: "/blog",
          name: "Блог",
          sessionsBudget: 500,
          sessionsCollected: 71,
          status: "ACTIVE",
        },
      }),
    ])

    // Analysis создаём только для COMPLETED targets (первые 3).
    // /blog в ACTIVE — копит сессии, ещё не анализировался.
    const completedTargets = targets.slice(0, 3)
    const analyses = await Promise.all(
      completedTargets.map((target, idx) =>
        tx.analysis.create({
          data: {
            siteId,
            targetId: target.id,
            requestedById: userId,
            status: "DONE",
            sessionsAnalyzed: target.sessionsCollected,
            tokensUsed: randInt(8000, 15000),
            recommendationsCount: 0,
            completedAt: daysAgo(idx + 1),
            prompt: `Analyze user behavior on ${target.url} (${target.sessionsCollected} sessions)`,
          },
        }),
      ),
    )

    const statusDistribution: Array<"NEW" | "IN_PROGRESS" | "DONE" | "REJECTED"> = [
      ...Array(9).fill("NEW"),
      ...Array(3).fill("IN_PROGRESS"),
      ...Array(2).fill("DONE"),
      ...Array(1).fill("REJECTED"),
    ]

    const recommendationsByAnalysis = new Map<string, number>()

    for (let i = 0; i < RECOMMENDATION_TEMPLATES.length; i++) {
      const tmpl = RECOMMENDATION_TEMPLATES[i]
      const analysis = analyses[tmpl.targetIndex]
      const status = statusDistribution[i % statusDistribution.length]

      const sortOrder = (recommendationsByAnalysis.get(analysis.id) ?? 0) + 1
      recommendationsByAnalysis.set(analysis.id, sortOrder)

      await tx.recommendation.create({
        data: {
          analysisId: analysis.id,
          priority: tmpl.priority,
          title: tmpl.title,
          description: tmpl.description,
          metric: tmpl.metric,
          sortOrder,
          status,
          acceptedAt:
            status === "IN_PROGRESS" || status === "DONE"
              ? daysAgo(randInt(0, 2))
              : null,
          appliedAt: status === "DONE" ? daysAgo(randInt(0, 1)) : null,
          rejectionReason:
            status === "REJECTED"
              ? "Решили отложить, не приоритет на этот квартал"
              : null,
        },
      })
    }

    for (const [analysisId, count] of Array.from(recommendationsByAnalysis.entries())) {
      await tx.analysis.update({
        where: { id: analysisId },
        data: { recommendationsCount: count },
      })
    }

    const sessions: Prisma.SessionCreateManyInput[] = []
    for (let i = 0; i < 50; i++) {
      const startedAt = new Date()
      startedAt.setUTCHours(startedAt.getUTCHours() - randInt(0, 7 * 24))

      const isCompleted = Math.random() < 0.6
      const duration = randInt(30, 600)
      const endedAt = isCompleted
        ? new Date(startedAt.getTime() + duration * 1000)
        : null

      const attachToTarget = Math.random() < 0.3
      const analysisTargetId = attachToTarget ? targets[randInt(0, 2)].id : null

      sessions.push({
        siteId,
        sessionToken: randomUUID(),
        ipHash: fakeIpHash(`demo-user-${randInt(1, 20)}`),
        userAgent: pick(USER_AGENTS),
        startedAt,
        endedAt,
        eventsCount: isCompleted ? randInt(20, 200) : randInt(5, 50),
        analysisTargetId,
      })
    }
    await tx.session.createMany({ data: sessions })
  })
}
