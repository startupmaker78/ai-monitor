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
  category: "USABILITY" | "CONTENT" | "MOBILE" | "PERFORMANCE" | "TRUST"
  title: string
  description: string
  problem: string
  evidence: string
  expectedImpact: string
  effort: "LOW" | "MEDIUM" | "HIGH"
  metric: string | null
}> = [
  {
    targetIndex: 0,
    priority: "CRITICAL",
    category: "MOBILE",
    title: "Основной CTA не виден на мобильных без скролла",
    description:
      "На устройствах с экраном до 6\" кнопка «Начать бесплатно» оказывается ниже первого экрана. По данным rrweb-сессий, 67% мобильных посетителей не доскроллили до неё. Поднять CTA в верхний блок hero-секции, либо добавить sticky-кнопку.",
    problem:
      "Кнопка «Начать бесплатно» уезжает за первый экран на устройствах с диагональю до 6 дюймов — мобильные посетители не доходят до целевого действия.",
    evidence:
      "Анализ rrweb-сессий с мобильных устройств: 67 из 100 посетителей не доскроллили до CTA в hero-секции.",
    expectedImpact:
      "Рост конверсии в регистрацию с мобильного трафика на 8-15%.",
    effort: "MEDIUM",
    metric: "Конверсия в регистрацию",
  },
  {
    targetIndex: 0,
    priority: "CRITICAL",
    category: "PERFORMANCE",
    title: "Долгая загрузка hero-изображения (LCP > 4s)",
    description:
      "Главное изображение в hero весит 1.8MB и грузится 4.2 секунды. Из 100 пользователей 23 уходят до отрисовки. Сжать через WebP, добавить loading='eager' и preload в <head>.",
    problem:
      "Hero-изображение весит 1.8MB и рендерится 4.2 секунды — почти четверть посетителей уходит до того как страница нарисуется.",
    evidence:
      "Замеры LCP и анализ ранних exit-событий: 23 из 100 посетителей закрывают вкладку до отрисовки hero.",
    expectedImpact: "Снижение bounce rate на 5-8%, рост среднего LCP-балла.",
    effort: "LOW",
    metric: "Bounce rate",
  },
  {
    targetIndex: 0,
    priority: "IMPORTANT",
    category: "TRUST",
    title: "Социальные доказательства слабо акцентированы",
    description:
      "Логотипы клиентов размещены в подвале серой плашкой. Из rrweb видно — на них почти никто не задерживается. Перенести в первый экран сразу под hero-блоком, добавить заголовок «Нам доверяют».",
    problem:
      "Логотипы клиентов спрятаны в подвале серой плашкой — посетители их не видят и не получают сигналов доверия в момент принятия решения.",
    evidence:
      "Анализ rrweb-сессий: время задержки взгляда на блоке логотипов в подвале близко к нулю.",
    expectedImpact:
      "Рост доверия и конверсии в первое целевое действие на 3-7%.",
    effort: "MEDIUM",
    metric: "Доверие пользователей",
  },
  {
    targetIndex: 0,
    priority: "IMPORTANT",
    category: "USABILITY",
    title: "Отсутствие чата для быстрых вопросов",
    description:
      "В сессиях прослеживается паттерн: пользователь читает hero → пытается найти ответ на вопрос «как именно работает» → возвращается → уходит. Нужен мини-чат или кнопка «Задать вопрос» с быстрым ответом.",
    problem:
      "У посетителей возникают вопросы «как именно работает», но способа задать их быстро нет — часть из них уходит без действия.",
    evidence:
      "Анализ паттернов поведения посетителей: типовой цикл «hero → поиск ответа → возврат → exit».",
    expectedImpact:
      "Рост среднего времени на странице и конверсии в заявку на 5-10%.",
    effort: "HIGH",
    metric: "Время на странице",
  },
  {
    targetIndex: 0,
    priority: "GOOD",
    category: "USABILITY",
    title: "Видеоролик в hero повышает engagement",
    description:
      "В 8 из 10 рекордингов пользователи задерживались на странице дольше когда был видеоролик. Если есть промо-ролик — добавить как фоновое автозапускающееся видео без звука.",
    problem:
      "Текстово-картиночный hero даёт меньший engagement, чем варианты с видеофоном — посетители быстрее переходят к скроллу или уходят.",
    evidence:
      "Сравнение рекордингов: 8 из 10 сессий с видео в hero показывают увеличенное время на странице.",
    expectedImpact:
      "Рост среднего времени на странице на 15-25%.",
    effort: "MEDIUM",
    metric: "Время на странице",
  },
  {
    targetIndex: 0,
    priority: "GOOD",
    category: "USABILITY",
    title: "Микроанимации усилят восприятие интерактивности",
    description:
      "Hover-эффекты на главных кнопках почти отсутствуют. Добавить лёгкое поднятие при наведении (transform: translateY(-2px)) — психологически создаст ощущение «живого» интерфейса.",
    problem:
      "Главные кнопки не реагируют на hover — интерфейс воспринимается статичным, что снижает воспринимаемое качество продукта.",
    evidence:
      "Аудит интерфейса страницы: hover-стили на основных CTA практически отсутствуют.",
    expectedImpact:
      "Улучшение восприятия интерактивности и качества интерфейса.",
    effort: "LOW",
    metric: null,
  },
  {
    targetIndex: 1,
    priority: "CRITICAL",
    category: "USABILITY",
    title: "Тарифы без сравнительной таблицы",
    description:
      "Пользователи на /pricing проводят в среднем 47 секунд и в 71% случаев уходят без выбора. Из rrweb видно — они скроллят вверх-вниз пытаясь сравнить тарифы. Добавить таблицу сравнения функций по строкам.",
    problem:
      "Тарифы перечислены отдельными карточками без построчного сравнения — посетители не могут быстро сопоставить функции и уходят без выбора.",
    evidence:
      "Анализ rrweb-рекордингов на /pricing: среднее время 47 секунд, 71% сессий завершаются без клика по тарифу, паттерн скролла «вверх-вниз».",
    expectedImpact: "Рост конверсии в оплату на 10-15%.",
    effort: "MEDIUM",
    metric: "Конверсия в оплату",
  },
  {
    targetIndex: 1,
    priority: "CRITICAL",
    category: "CONTENT",
    title: "Цена в верхнем блоке, без указания «в месяц/год»",
    description:
      "В hero на /pricing видно «4 990 ₽» без пометки периодичности. Несколько сессий показывают повторное возвращение к странице — пользователи перепроверяют. Добавить «/мес» крупно сразу под цифрой.",
    problem:
      "Цена «4 990 ₽» в hero без пометки периодичности вызывает неуверенность — посетители возвращаются на страницу для перепроверки, теряя темп воронки.",
    evidence:
      "Анализ паттернов навигации: фиксируются повторные возвраты на /pricing в рамках одной сессии.",
    expectedImpact: "Снижение неуверенности, рост конверсии в оплату на 2-5%.",
    effort: "LOW",
    metric: "Конверсия в оплату",
  },
  {
    targetIndex: 1,
    priority: "IMPORTANT",
    category: "USABILITY",
    title: "Кнопка «Выбрать план» одинакова на всех тарифах",
    description:
      "Рекомендуемый тариф (Стандартный) визуально не выделен. Сделать его кнопку primary (синий заполненный), у остальных — outline. Также увеличить тариф в высоту на 8-10%.",
    problem:
      "Рекомендуемый тариф «Стандартный» не выделен визуально — посетители не получают подсказки и распределяются по тарифам случайно.",
    evidence:
      "Анализ распределения кликов по карточкам тарифов: доля «Стандартного» близка к доле остальных.",
    expectedImpact:
      "Рост доли пользователей выбирающих рекомендуемый тариф на 15-20%.",
    effort: "LOW",
    metric: "Распределение по тарифам",
  },
  {
    targetIndex: 1,
    priority: "IMPORTANT",
    category: "CONTENT",
    title: "FAQ на странице оплаты отсутствует",
    description:
      "По воронке видно: 34% пришедших на /pricing уходят на /faq, 60% из них не возвращаются. Добавить блок FAQ внизу страницы тарифов: «Можно ли отменить подписку?», «Что если данных недостаточно для анализа?»",
    problem:
      "На /pricing нет ответов на типовые сомнения — посетители уходят на /faq и больше не возвращаются к выбору тарифа.",
    evidence:
      "Анализ воронки страниц: 34% посетителей /pricing переходят на /faq, 60% из них не возвращаются.",
    expectedImpact: "Рост конверсии в оплату на 5-10%.",
    effort: "MEDIUM",
    metric: "Конверсия в оплату",
  },
  {
    targetIndex: 1,
    priority: "GOOD",
    category: "CONTENT",
    title: "Годовой план не имеет визуальной экономии",
    description:
      "Сейчас годовой план просто упомянут как опция. Добавить badge «Экономия 17%» рядом с переключателем месяц/год — это типовой паттерн повышения ARPU.",
    problem:
      "Годовой план показан как опция без указания экономии — стимула выбрать его у посетителя нет.",
    evidence:
      "Анализ распределения подписок: доля годовых планов значительно ниже типового бенчмарка.",
    expectedImpact:
      "Рост ARPU за счёт перехода части пользователей на годовой план.",
    effort: "LOW",
    metric: "ARPU",
  },
  {
    targetIndex: 2,
    priority: "IMPORTANT",
    category: "USABILITY",
    title: "Текст «О нас» слишком длинный, нет якорей",
    description:
      "Страница /about содержит ~1800 слов сплошным потоком. Среднее время чтения — 1:20, после которого 80% уходят. Разбить на разделы с якорями (Команда / История / Миссия), добавить навигацию по якорям сверху.",
    problem:
      "Страница /about — 1800 слов сплошным потоком без навигации; после ~80 секунд чтения подавляющее большинство уходит, не дочитав.",
    evidence:
      "Анализ глубины скролла и времени на странице: 80% посетителей покидают /about после 1:20.",
    expectedImpact: "Рост среднего времени на странице на 20-30%.",
    effort: "MEDIUM",
    metric: "Время на странице",
  },
  {
    targetIndex: 2,
    priority: "IMPORTANT",
    category: "USABILITY",
    title: "Нет призыва после прочтения «О нас»",
    description:
      "Пользователь долистал до конца страницы → закрыл вкладку. Из 100 человек только 4 переходят отсюда на /pricing. В конец /about добавить блок «Готовы попробовать?» с двумя CTA: «Бесплатная регистрация» и «Тарифы».",
    problem:
      "В конце /about нет CTA — посетители, заинтересовавшиеся компанией, закрывают вкладку вместо перехода к продукту.",
    evidence:
      "Анализ воронки переходов между страницами: только 4 из 100 посетителей /about переходят на /pricing.",
    expectedImpact: "Рост конверсии из /about в /pricing на 5-10%.",
    effort: "LOW",
    metric: "Конверсия из /about",
  },
  {
    targetIndex: 2,
    priority: "GOOD",
    category: "TRUST",
    title: "Фотографии команды отсутствуют",
    description:
      "Раздел «Команда» представлен только текстом. Добавить фото 3-5 ключевых сотрудников с короткими bio. Это типовой паттерн повышения доверия для B2B-продуктов.",
    problem:
      "Раздел «Команда» — только текст; B2B-аудитория недополучает сигнал «за продуктом стоят реальные люди».",
    evidence:
      "Аудит страницы /about: блок «Команда» не содержит изображений сотрудников.",
    expectedImpact: "Рост доверия для B2B-аудитории и конверсии на 2-5%.",
    effort: "MEDIUM",
    metric: "Доверие пользователей",
  },
  {
    targetIndex: 2,
    priority: "GOOD",
    category: "TRUST",
    title: "Социальные ссылки команды могут усилить доверие",
    description:
      "Под фото команды добавить иконки LinkedIn / Twitter (по желанию сотрудников). Это создаёт ощущение «реальных людей за продуктом».",
    problem:
      "Под профилями команды нет ссылок на их соцсети — посетители не могут проверить «реальность» сотрудников.",
    evidence:
      "Аудит страницы /about: профили команды без ссылок на LinkedIn/Twitter.",
    expectedImpact:
      "Усиление ощущения «реальных людей» за продуктом, +1-3% к доверию.",
    effort: "LOW",
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
          category: tmpl.category,
          title: tmpl.title,
          description: tmpl.description,
          problem: tmpl.problem,
          evidence: tmpl.evidence,
          expectedImpact: tmpl.expectedImpact,
          effort: tmpl.effort,
          lowConfidence: false,
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
