// One-shot fix: домен `nolim.сс` (с кириллической `с` U+0441 — две штуки)
// → `nolim.cc` (латинская `c` U+0063). Создан случайно при переключении
// раскладки до того как мы добавили ASCII-валидацию в lib/site-utils.ts.
//
// usage: npm run fix:nolim-domain
//
// После прогона больше не нужен. Не удаляем — оставляем как пример
// safe one-time data fix.

import { prisma } from "../lib/prisma"

// ВАЖНО: эти строки визуально похожи, но содержат разные unicode.
// CYRILLIC_DOMAIN — что лежит в БД (две кириллических `с`, U+0441).
// LATIN_DOMAIN    — что должно быть после фикса (две латинских `c`, U+0063).
// Скопированы прямо из live SQL-row, не печатать руками.
const CYRILLIC_DOMAIN = "nolim.сс" // nolim.сс
const LATIN_DOMAIN = "nolim.cc"

async function main() {
  console.log("=== Fix nolim domain (cyrillic с → latin c) ===")
  console.log(`Cyrillic source: ${CYRILLIC_DOMAIN}`)
  console.log(`Latin target:    ${LATIN_DOMAIN}`)

  const sites = await prisma.site.findMany({
    where: { domain: CYRILLIC_DOMAIN },
    select: { id: true, domain: true },
  })
  console.log(`\nFound ${sites.length} sites with cyrillic domain`)

  if (sites.length === 0) {
    console.log("Nothing to fix — already done or never existed.")
    await prisma.$disconnect()
    return
  }

  for (const site of sites) {
    await prisma.site.update({
      where: { id: site.id },
      data: { domain: LATIN_DOMAIN },
    })
    console.log(`  ✓ Fixed site ${site.id}`)
  }

  console.log("\n=== Done ===")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error("FATAL:", e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
