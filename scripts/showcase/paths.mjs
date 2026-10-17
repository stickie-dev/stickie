// The showcase's places, for its node scripts; env.sh sets the same for the shell ones.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const showcase = path.dirname(fileURLToPath(import.meta.url))
export const root = path.resolve(showcase, '../..')
export const work = process.env.STICKIE_SHOWCASE_WORK ?? path.join(showcase, '.work')
export const out = path.join(root, 'docs/images')
export const repos = { api: path.join(work, 'repos/orbit-api'), web: path.join(work, 'repos/orbit-web') }
