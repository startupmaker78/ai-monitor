/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async headers() {
    // /tracker.js — статик из public/, по умолчанию Next отдаёт max-age=0
    // (ревалидация каждый заход). Кэшируем: 1ч без запросов, потом до суток
    // отдаём из кэша сразу + ревалидируем в фоне (SWR). Версионное имя НЕ
    // берём — сниппет у клиента статичный. Обновление трекера доезжает за ~1ч
    // (гарантированная ревалидация после max-age); трекер backward-compatible,
    // так что кратковременный старый кэш безопасен.
    return [
      {
        source: "/tracker.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
  webpack(config) {
    // Импорт .md как сырой строки (единый источник текста гайда — сам .md,
    // правится на GitHub; инлайнится в бандл на сборке, без runtime-fs, что
    // важно для output:standalone). См. app/guide/metrika/page.tsx.
    config.module.rules.push({
      test: /\.md$/,
      type: "asset/source",
    });
    return config;
  },
};

export default nextConfig;
