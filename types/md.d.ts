// Импорт .md как сырой строки (webpack rule type:"asset/source" в
// next.config.mjs). Единственный источник текста гайда — файл .md.
declare module "*.md" {
  const content: string
  export default content
}
