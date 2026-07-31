// Проверка перед сборкой: каждый слаг из GUIDE_ANCHORS реально присутствует
// заголовком в docs/metrika-goals-guide.md. Если Лёша переименует заголовок —
// слаг исчезнет, скрипт упадёт, CI станет красным (RUN npm run build в
// Dockerfile → prebuild). Это ловит ТИХИЙ уезд якоря на верх страницы: правка
// текста ломает сборку, а не ссылку молча.
//
// Слаги считаем github-slugger'ом — ровно той библиотекой, что использует
// rehype-slug на самой странице, поэтому слаги идентичны рендеру.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import GithubSlugger from "github-slugger"
import { GUIDE_ANCHORS, GUIDE_MD_PATH } from "../lib/guide-anchors"

function headingSlugs(markdown: string): Set<string> {
  const slugger = new GithubSlugger()
  const slugs = new Set<string>()
  for (const line of markdown.split("\n")) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    // Заголовки гайда — простой текст без инлайн-разметки; github-slugger по
    // тексту даёт тот же слаг, что rehype-slug по отрендеренному заголовку.
    slugs.add(slugger.slug(m[1]))
  }
  return slugs
}

const md = readFileSync(join(process.cwd(), GUIDE_MD_PATH), "utf8")
const present = headingSlugs(md)
const wanted = Object.values(GUIDE_ANCHORS)
const missing = wanted.filter((a) => !present.has(a))

if (missing.length > 0) {
  console.error(
    `\n[check-guide-anchors] ОШИБКА: якоря из GUIDE_ANCHORS не найдены как ` +
      `заголовки в ${GUIDE_MD_PATH}:\n` +
      missing.map((a) => `  • #${a}`).join("\n") +
      `\n\nЗаголовок переименовали? Обнови слаг в lib/guide-anchors.ts под ` +
      `новый заголовок (и ссылки на гайд поедут на нужный раздел).\n` +
      `Найденные слаги: ${Array.from(present)
        .map((s) => "#" + s)
        .join(", ")}\n`,
  )
  process.exit(1)
}

console.log(
  `[check-guide-anchors] OK — все якоря на месте: ${wanted
    .map((a) => "#" + a)
    .join(", ")}`,
)
