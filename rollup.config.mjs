import { defineConfig } from 'rollup'
import terser from '@rollup/plugin-terser'
import typescript from '@rollup/plugin-typescript'

import pkg from './package.json' assert { type: 'json' }

export default defineConfig({
	input: 'src/index.ts',
	output: { file: 'dist/index.mjs', format: 'esm', compact: true },
	external: [
		...Object.keys(pkg.peerDependencies),
		'viem/chains',
		'viem/window',
	],
	plugins: [typescript(), terser()],
})
