import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const FILES = ['text.js', 'prompt.js', 'stability.js', 'suggest.js']
const MARKER = '/*@@ENGINE@@*/'

/**
 * 浏览器端插件只有一个被服务的文件（<pkg>/client.js），没有构建产物可 import。
 * 所以 engine/ 保持 ESM（Node 里可直接跑测试），发布时把它的源码内联进一个闭包。
 */
function inlineEngine() {
	const bodies = []
	const names = []
	for (const file of FILES) {
		const source = readFileSync(join(root, 'engine', file), 'utf8')
		const lines = []
		for (const line of source.split('\n')) {
			if (/^import\s/.test(line)) continue
			const exported = line.match(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z0-9_$]+)/)
			if (exported) names.push(exported[1])
			lines.push(line.replace(/^export\s+/, ''))
		}
		bodies.push(`// ---- engine/${file} ----\n${lines.join('\n').trim()}`)
	}
	return `(() => {\n${bodies.join('\n\n')}\n\nreturn { ${names.join(', ')} }\n})()`
}

const template = readFileSync(join(root, 'client.src.js'), 'utf8')
if (!template.includes(MARKER)) throw new Error(`client.src.js 缺少 ${MARKER}`)
const out = template.replace(MARKER, inlineEngine())
writeFileSync(join(root, 'client.js'), out)

// 内联结果必须能在 Node 里 parse，也能真的跑起来——跑在临时文件里，不碰浏览器。
const check = join(mkdtempSync(join(tmpdir(), 'intent-engine-')), 'engine.mjs')
writeFileSync(check, `export const engine = ${inlineEngine()}\n`)
await import(pathToFileURL(check).href)
console.log(`client.js 已生成（engine 内联 ${FILES.length} 个文件）`)
