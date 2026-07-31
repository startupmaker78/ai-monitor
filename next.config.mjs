/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
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
