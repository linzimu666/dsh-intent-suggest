import { COMPILE_SYSTEM, parseCompiled, scanCompletedItems } from './prompt.js'

/** 宿主插件注册的转发口：同一个 provider、同一份凭据，插件不再自己配 key。 */
export const CONTEXT_PATH = '/intent-suggest/context'
export const SUGGEST_PATH = '/intent-suggest/suggest'

export async function fetchRecentTurns(sessionId, { base = '', fetchImpl = globalThis.fetch, signal } = {}) {
	const url = `${base}${CONTEXT_PATH}?sessionId=${encodeURIComponent(sessionId ?? '')}`
	const response = await fetchImpl(url, { cache: 'no-store', credentials: 'same-origin', signal })
	if (!response.ok) throw new Error(`读取上下文失败 (${response.status})`)
	const data = await response.json()
	return Array.isArray(data.turns) ? data.turns : []
}

/**
 * 打开发票口的 SSE，边收边解析半截 JSON。
 * onItems 只在"比上一次多解析出候选"时触发，第一条候选因此不必等全文到齐。
 */
export async function streamSuggestion(payload, { base = '', fetchImpl = globalThis.fetch, signal, onItems, directions, startedAt = Date.now() } = {}) {
	const response = await fetchImpl(`${base}${SUGGEST_PATH}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		credentials: 'same-origin',
		body: JSON.stringify(payload),
		signal,
	})
	if (!response.ok || !response.body) throw new Error(`生成失败 (${response.status})`)

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	let text = ''
	let emitted = 0
	let firstItemMs = null
	let usage = null
	let failure = null

	const handle = (event) => {
		if (event.delta) {
			text += event.delta
			const scanned = scanCompletedItems(text, directions)
			if (scanned.items.length > emitted) {
				if (firstItemMs === null) firstItemMs = Date.now() - startedAt
				emitted = scanned.items.length
				if (onItems) onItems(scanned.items)
			}
			return
		}
		if (event.usage) usage = event.usage
		if (event.error) failure = event.error
		if (event.finish && event.finish.reason && event.finish.reason.kind !== 'stop') {
			failure = (event.finish.reason.failure && event.finish.reason.failure.message) || `stream ${event.finish.reason.kind}`
		}
	}

	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		buffer += decoder.decode(value, { stream: true })
		let cut = buffer.indexOf('\n\n')
		while (cut >= 0) {
			const frame = buffer.slice(0, cut)
			buffer = buffer.slice(cut + 2)
			for (const line of frame.split('\n')) {
				if (!line.startsWith('data: ')) continue
				try {
					handle(JSON.parse(line.slice(6)))
				} catch {
					/* 非 JSON 帧（心跳等）忽略 */
				}
			}
			cut = buffer.indexOf('\n\n')
		}
	}

	if (failure) throw new Error(String(failure))
	return { text, usage, firstItemMs, latencyMs: Date.now() - startedAt }
}

/**
 * 用户自述 → 一套 system prompt + 方向表。
 * 只在画像停笔后跑一次，结果连同描述缓存起来，不进击键通路。
 */
export async function compilePersona(description, { base = '', fetchImpl = globalThis.fetch, signal } = {}) {
	const outcome = await streamSuggestion(
		{
			system: COMPILE_SYSTEM,
			messages: [{ role: 'user', content: [{ type: 'text', text: String(description).trim().slice(0, 300) }] }],
			maxTokens: 1400,
			temperature: 0.4,
		},
		{ base, fetchImpl, signal },
	)
	const compiled = parseCompiled(outcome.text)
	if (!compiled) throw new Error('生成的提示词解析不了，改一句再试')
	return compiled
}
