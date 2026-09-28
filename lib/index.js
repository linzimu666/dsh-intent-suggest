export const name = 'dsh-intent-suggest'
export const inject = []

const MAX_BODY_BYTES = 64 * 1024
const CONTEXT_TURNS = 6
const TURN_MAX_CHARS = 700

function turnText(message) {
	return (message.content || [])
		.filter((block) => block.type === 'text')
		.map((block) => block.text)
		.join('\n')
		.trim()
}

/** deriveMessages 是循环真正发给模型的那份历史：已折叠压缩、已按 role 标好。 */
function recentTurns(session, limit) {
	const picks = []
	for (const message of session.deriveMessages()) {
		if (message.role !== 'user' && message.role !== 'assistant') continue
		// user/message 也承载注入上下文与目标续跑，只有 source.kind==='user' 才是人打的
		if (message.role === 'user' && message.source?.kind !== 'user') continue
		const text = turnText(message)
		if (!text) continue
		picks.push({ role: message.role, text: text.length > TURN_MAX_CHARS ? `${text.slice(0, TURN_MAX_CHARS)}…` : text })
	}
	return picks.slice(-limit)
}

function sendJson(response, status, payload) {
	response.writeHead(status, {
		'cache-control': 'no-store',
		'content-type': 'application/json; charset=utf-8',
	})
	response.end(JSON.stringify(payload))
}

function denySameOrigin(response) {
	response.writeHead(403, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
	response.end(JSON.stringify({ ok: false, error: 'cross-origin blocked' }))
}

function allowed(request) {
	const headers = request.headers || {}
	const site = String(headers['sec-fetch-site'] || '').toLowerCase()
	if (site === 'cross-site') return false
	const origin = String(headers.origin || '').trim()
	if (origin === 'null') return false
	if (!origin) return true
	let originHost
	try {
		originHost = new URL(origin).host
	} catch {
		return false
	}
	return originHost.toLowerCase() === String(headers.host || '').trim().toLowerCase()
}

function readJson(request) {
	return new Promise((resolve, reject) => {
		const chunks = []
		let size = 0
		request.on('data', (chunk) => {
			size += chunk.length
			if (size > MAX_BODY_BYTES) {
				reject(new Error('payload too large'))
				request.destroy()
				return
			}
			chunks.push(chunk)
		})
		request.on('end', () => {
			try {
				resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
			} catch (e) {
				reject(e)
			}
		})
		request.on('error', reject)
	})
}

function sseHead(response) {
	response.writeHead(200, {
		'cache-control': 'no-store',
		'content-type': 'text/event-stream; charset=utf-8',
		connection: 'keep-alive',
		'x-accel-buffering': 'no',
	})
}

function sseEvent(response, data) {
	response.write(`data: ${JSON.stringify(data)}\n\n`)
}

async function stream(host, config, request, response) {
	const body = await readJson(request)
	const fragment = String(body.fragment ?? '').trim()
	const provider = String(body.provider || config.provider || '') || host.llm.listProviders()[0]?.id || ''
	let model = String(body.model || config.model || '')
	if (!model) model = (await host.llm.listModels(provider))[0]?.id || ''

	sseHead(response)
	const controller = new AbortController()
	request.on('close', () => controller.abort())

	let text = ''
	for await (const chunk of host.llm.stream({
		provider,
		model,
		system: String(body.system ?? ''),
		messages: Array.isArray(body.messages) ? body.messages : [],
		...(body.temperature === undefined ? {} : { temperature: Number(body.temperature) }),
		maxTokens: Number(body.maxTokens ?? config.maxTokens ?? 700),
		// deepseek-flash reasons by default; a JSON answer needs thinking off.
		reasoningEffort: 'off',
		signal: controller.signal,
	})) {
		if (chunk.type === 'text-delta') {
			text += chunk.text
			sseEvent(response, { delta: chunk.text })
		} else if (chunk.type === 'block-start') {
			sseEvent(response, { blockStart: chunk.blockType })
		} else if (chunk.type === 'reasoning-delta') {
			sseEvent(response, { reasoningDelta: chunk.text })
		} else if (chunk.type === 'usage') {
			sseEvent(response, { usage: chunk.usage })
		} else if (chunk.type === 'finish') {
			sseEvent(response, { finish: chunk })
		}
	}
	sseEvent(response, { done: true, chars: text.length })
	response.end()
}

export function apply(ctx, config = {}) {
	ctx.inject(['llm', 'sessions', 'webServer'], (host) => {
		host.effect(() => {
			host.webServer.register({
				kind: 'exact',
				path: '/intent-suggest/providers',
				handler: async (request, response) => {
					if (!allowed(request)) return denySameOrigin(response)
					if (request.method !== 'GET') {
						response.writeHead(405, { allow: 'GET' })
						return response.end()
					}
					const providers = host.llm.listProviders()
					const models = {}
					for (const p of providers) {
						models[p.id] = await host.llm.listModels(p.id).then((list) => list.map((m) => m.id ?? m.model)).catch((e) => String(e.message))
					}
					sendJson(response, 200, { ok: true, providers, models, config })
				},
			}, 'dsh-intent-suggest: providers')

			host.webServer.register({
				kind: 'exact',
				path: '/intent-suggest/context',
				handler: async (request, response) => {
					if (!allowed(request)) return denySameOrigin(response)
					if (request.method !== 'GET') {
						response.writeHead(405, { allow: 'GET' })
						return response.end()
					}
					try {
						const sessionId = new URL(request.url, 'http://127.0.0.1').searchParams.get('sessionId') || ''
						const session = sessionId ? host.sessions?.get?.(sessionId) : null
						sendJson(response, 200, { ok: true, turns: session ? recentTurns(session, CONTEXT_TURNS) : [] })
					} catch (e) {
						sendJson(response, 500, { ok: false, error: String(e && e.message ? e.message : e) })
					}
				},
			}, 'dsh-intent-suggest: context')

			host.webServer.register({
				kind: 'exact',
				path: '/intent-suggest/suggest',
				handler: async (request, response) => {
					if (!allowed(request)) return denySameOrigin(response)
					if (request.method !== 'POST') {
						response.writeHead(405, { allow: 'POST' })
						return response.end()
					}
					try {
						await stream(host, config, request, response)
					} catch (e) {
						const message = String(e && e.message ? e.message : e)
						if (response.headersSent) {
							sseEvent(response, { error: message })
							response.end()
						} else {
							sendJson(response, 500, { ok: false, error: message })
						}
					}
				},
			}, 'dsh-intent-suggest: suggest')
		}, 'dsh-intent-suggest: http routes')
	})
}

export default { name, inject, apply }
