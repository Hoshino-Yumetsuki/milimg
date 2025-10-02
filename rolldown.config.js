import { defineConfig } from 'rolldown'
import pkg from './package.json' with { type: 'json' }
import { dts } from 'rolldown-plugin-dts'

const external = new RegExp(
  `^(node:|${[...Object.getOwnPropertyNames(pkg.devDependencies ? pkg.devDependencies : [])].join('|')})`
)

const config = {
  input: './src/index.ts'
}

export default defineConfig([
  {
    ...config,
    output: [{ file: 'lib/index.js', format: 'esm', minify: true }],
    platform: 'browser',
    external: external
  },
  {
    ...config,
    output: [{ dir: 'lib', format: 'esm' }],
    plugins: [dts({ emitDtsOnly: true })],
    external: external
  }
])
