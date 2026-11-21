import sharp from 'sharp'
const full = 'scripts/icon-full.svg'
const out = [
  ['public/pwa-192.png', 192], ['public/pwa-512.png', 512], ['public/apple-touch-icon.png', 180], ['build/icon.png', 512],
]
import { mkdirSync } from 'node:fs'
mkdirSync('build', { recursive: true })
for (const [file, size] of out) await sharp(full, { density: 600 }).resize(size, size).png().toFile(file)
await sharp('public/favicon.svg', { density: 600 }).resize(1024, 1024).png().toFile('build/icon-1024.png')
console.log('icons done')
