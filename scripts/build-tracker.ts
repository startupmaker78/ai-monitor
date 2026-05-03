import * as esbuild from 'esbuild'
import * as path from 'path'
import * as fs from 'fs'

const publicDir = path.join(process.cwd(), 'public')
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true })
}

const isWatch = process.argv.includes('--watch')
const isProd =
  process.env.NODE_ENV === 'production' || process.argv.includes('--prod')

const config: esbuild.BuildOptions = {
  entryPoints: ['tracker-src/index.ts'],
  outfile: 'public/tracker.js',
  bundle: true,
  minify: isProd,
  sourcemap: !isProd,
  format: 'iife',
  platform: 'browser',
  target: 'es2017',
  legalComments: 'none',
  logLevel: 'info',
  banner: {
    js: '/* Webmonitor tracker - https://вебмонитор.рф */',
  },
}

async function main() {
  if (isWatch) {
    const ctx = await esbuild.context(config)
    await ctx.watch()
    console.log('🔄 Watching tracker-src/ for changes...')
  } else {
    const result = await esbuild.build(config)
    const stats = fs.statSync('public/tracker.js')
    const sizeKB = (stats.size / 1024).toFixed(1)
    console.log(`✅ Built public/tracker.js (${sizeKB} KB)`)
    if (result.warnings.length > 0) {
      console.warn('Warnings:', result.warnings)
    }
  }
}

main().catch((err) => {
  console.error('❌ Build failed:', err)
  process.exit(1)
})
