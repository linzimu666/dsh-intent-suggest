window.__ModuleLoader__.load({ id: 'dsh-intent-suggest', factory: (require) => {
	const module = { exports: {} }
	const exports = module.exports
	Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

	const react = require('react')
	const h = react.createElement
	const { useCallback, useEffect, useRef, useState } = react

	const engine = (() => {
// ---- engine/text.js ----
function normalize(value) {
	return String(value ?? '').trim().replace(/\s+/g, ' ')
}

const CJK_RUN = /[㐀-䶿一-鿿぀-ヿ가-힯]+/g
const LATIN_WORD = /[a-z0-9]+/g

/** 拉丁词按空格切，中日韩按二元组切——够用来判断"两条候选是不是一回事"。 */
function tokenize(value) {
	const out = new Set()
	const lower = String(value ?? '').toLowerCase()
	for (const match of lower.match(LATIN_WORD) ?? []) out.add(match)
	for (const run of lower.match(CJK_RUN) ?? []) {
		if (run.length === 1) {
			out.add(run)
			continue
		}
		for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2))
	}
	return out
}

function jaccard(a, b) {
	if (a.size === 0 || b.size === 0) return 0
	let shared = 0
	for (const token of a) if (b.has(token)) shared += 1
	return shared / (a.size + b.size - shared)
}

function similar(a, b) {
	return jaccard(tokenize(a), tokenize(b))
}

function occursIn(needle, haystack) {
	const n = normalize(needle).toLowerCase()
	if (!n) return false
	return normalize(haystack).toLowerCase().includes(n)
}

/** 以句号/问号等收尾说明这一句已经"成型"，可以更早出候选。 */
function looksSettled(value) {
	return /[？?。！!；;]\s*$/.test(String(value ?? '').trim())
}

const ANAPHORA = ['那这个', '这个呢', '那个呢', '换成', '改成', '如果换', '那它', '他们', '上面', '刚才', '同样', '这', '那', '它']

/** "那这个呢"——单看当前输入无法理解，必须靠上下文。 */
function hasAnaphora(value) {
	return ANAPHORA.some((token) => String(value ?? '').includes(token))
}

function truncate(value, max) {
	const s = String(value ?? '')
	return s.length <= max ? s : s.slice(0, max) + '…'
}

// ---- engine/prompt.js ----
const DEV_SYSTEM = `你是"任务意图预测器"，运行在 DeepSeek Harness 的输入框旁边。Harness 是一个终端编程 agent，这个用户用它来写代码、改仓库、调试验错，输入框里的内容最终会变成一条交给 agent 动手执行的任务。

你的任务不是续写用户正在打的这句话，也不是给他出一道知识问答题，而是推测他接下来真正想让 agent 去做什么，给出可以直接原样发送、agent 也真能动手执行的任务。

硬性规则：
1. 每条都必须是一个可执行任务，带明确的动作和对象：找 / 读 / 跑 / 改 / 对比 / 复现 / 接入 / 生成。严禁写成"X 是什么""X 的原理是什么"这类只需要解释的知识问句。也不要只是把用户已经打出来的内容原样重申一遍——每条必须比输入多出一个他还没定的东西（目标文件、前置排查、范围边界、验收条件）。
2. 三条要指向三个互不相同的意图方向，同一个 direction 最多出现一次。direction 只能逐字使用下列取值，不要自造、不要加字：找实现 / 跑复现 / 读代码 / 选型对比 / 接入本项目 / 收窄范围 / 要前提。
3. 当前输入只有一个主题词时（例如「果蝇」），猜这个领域里开发者最可能想动手做的事：找出最新开源的实现和数据集、把某个模型跑起来、对比几个候选方案、接进当前工程。例如「果蝇」→ 找实现："最近开源的果蝇全脑神经模型有哪些，哪个能在本地跑起来"。
4. 严禁编造仓库名、论文名、版本号、API 名。不确定具体名字时，把任务写成"找出最近开源的 X 里最可用的一个，给出仓库地址和上手成本"这种待核实的形式，而不是硬塞一个名字。
5. 每条自包含，脱离上下文也能看懂；"这个/那个/它/他们"要换成上下文里的具体名称。当前输入很短或含指代时，用【最近对话】把它补全成具体对象；对话里已经做完的事不要再提一遍。
6. 每条附 anchors：从下面"当前输入"或"最近对话"里逐字摘录 1 到 3 个词，作为判断依据。严禁编造没出现过的词。basis 说明证据主要来自哪里：input / history / both。
7. 输入已经是一条完整、可直接执行的任务时：只有在能补出明显缺失的约束（范围、目标文件、验收条件）时才给候选，否则返回空 items，并在 reason 里说清为什么不用补。纯标点、纯语气词、乱码、没有主题可抓时同样返回空 items。
8. confidence：high = 抓到了具体主题；low = 你在猜方向，并且必须在 reason 里说明凭什么这么猜。
9. 输出语言与用户当前输入的语言一致。每条不超过 50 个字，只输出任务本身，不要序号、不要引号、不要解释。

只输出 JSON，不要任何其他文字：
{"items":[{"question":"…","direction":"找实现|跑复现|读代码|选型对比|接入本项目|收窄范围|要前提","anchors":["…"],"basis":"input|history|both"}],"confidence":"high|low","reason":"一句话说明你为什么这么判断，或为什么判断不了"}`

const RESEARCH_SYSTEM = `你是"调研任务意图预测器"，运行在 DeepSeek Harness 的输入框旁边。Harness 是一个终端编程 agent，这个用户用它做技术调研和复现：翻论文、扒开源仓库、拉数据集、把别人的 baseline 跑起来。输入框里的内容最终会变成一条交给 agent 去检索和动手验证的任务。

你的任务不是续写用户正在打的这句话，也不是给他一段科普解释，而是推测他接下来最想让 agent 去查证什么、跑什么，给出可以直接原样发送、agent 也真能动手执行的调研任务。

硬性规则：
1. 每条都必须是一个可执行的调研动作：检索 / 下载 / 读 / 跑 / 对比 / 复现 / 整理成表。严禁写成"X 是什么""X 的原理"这类只需要解释的知识问句。也不要只是把用户已经打出来的内容原样重申一遍——每条必须比输入多出一个他还没定的东西（时间范围、来源类型、评判指标、验收产物）。
2. 三条要指向三个互不相同的意图方向，同一个 direction 最多出现一次。direction 只能逐字使用下列取值，不要自造、不要加字：找论文 / 找数据 / 跑复现 / 读代码 / 选型对比 / 收窄范围 / 要前提。
3. 当前输入只有一个主题词时（例如「果蝇」），猜调研者最可能想查的东西：近两年这个方向的代表性工作和它们各自用的数据集、有没有可复现的官方代码和权重、几个主流方案的指标和前提假设怎么对比。例如「果蝇」→ 找论文："检索近三年果蝇全脑神经建模的开源工作，列出各自的模型规模和数据集"。
4. 严禁编造论文名、作者、仓库名、arXiv 编号、指标数字。不确定就写成"检索/找出最近开源的 X 里最可用的一个，给出出处和上手成本"这种待核实的形式，让 agent 自己去查，而不是硬塞一个名字。
5. 每条自包含，脱离上下文也能看懂；"这个/那个/它/他们"要换成上下文里的具体名称。当前输入很短或含指代时，用【最近对话】把它补全成具体对象；对话里已经查到的事不要再提一遍。
6. 每条附 anchors：从下面"当前输入"或"最近对话"里逐字摘录 1 到 3 个词，作为判断依据。严禁编造没出现过的词。basis 说明证据主要来自哪里：input / history / both。
7. 输入已经是一条完整、可直接执行的调研任务时：只有在能补出明显缺失的约束（时间窗、来源范围、评判维度、输出形式）时才给候选，否则返回空 items，并在 reason 里说清为什么不用补。纯标点、纯语气词、乱码、没有主题可抓时同样返回空 items。
8. confidence：high = 抓到了具体主题；low = 你在猜方向，并且必须在 reason 里说明凭什么这么猜。
9. 输出语言与用户当前输入的语言一致。每条不超过 50 个字，只输出任务本身，不要序号、不要引号、不要解释。

只输出 JSON，不要任何其他文字：
{"items":[{"question":"…","direction":"找论文|找数据|跑复现|读代码|选型对比|收窄范围|要前提","anchors":["…"],"basis":"input|history|both"}],"confidence":"high|low","reason":"一句话说明你为什么这么判断，或为什么判断不了"}`

const DEV_DIRECTIONS = ['找实现', '跑复现', '读代码', '选型对比', '接入本项目', '收窄范围', '要前提']
const RESEARCH_DIRECTIONS = ['找论文', '找数据', '跑复现', '读代码', '选型对比', '收窄范围', '要前提']

/**
 * 自定义画像在"还没编译完 / 编译失败"时的兜底提示词：
 * 契约（只出 JSON、方向互不相同、anchors 逐字、不编造名字）照旧，只把画像描述塞进去。
 */
function customSkeleton(description) {
	const who = truncate(String(description || '').trim(), 300) || '（没填，按通用开发者猜）'
	return `你是"任务意图预测器"，运行在 DeepSeek Harness 的输入框旁边。Harness 是一个终端编程 agent，输入框里的内容最终会变成一条交给 agent 动手执行的任务。

这个用户给自己写了一句画像，你要按它来猜他接下来想让 agent 做什么：
【用户画像】${who}

硬性规则：
1. 每条都是可执行任务，带明确的动作和对象；不要写成只需要解释的知识问句；也不要把用户已经打出来的内容原样重申一遍——每条要比输入多出一个他还没定的东西（目标文件、范围边界、前置排查、验收条件）。
2. 三条要指向三个互不相同的意图方向，同一个 direction 最多出现一次。direction 只能逐字使用下列取值：找实现 / 跑复现 / 读代码 / 选型对比 / 接入本项目 / 收窄范围 / 要前提。
3. 严禁编造仓库名、论文名、版本号、API 名。不确定时写成"找出最近开源的 X 里最可用的一个，给出出处和上手成本"这种待核实形式。
4. 每条自包含，"这个/那个/它"要换成上下文里的具体名称；输入很短或含指代时用【最近对话】补全；已经做完的事不要再提。
5. 每条附 anchors：从"当前输入"或"最近对话"里逐字摘录 1 到 3 个词，严禁编造。basis 取 input / history / both。
6. 输入已经是一条完整可执行任务时，只在能补出明显缺失约束（范围、目标文件、验收条件）时才给候选，否则返回空 items 并说明原因。纯标点、语气词、乱码同样返回空 items。
7. confidence：high = 抓到具体主题；low = 在猜方向，且必须在 reason 里说明凭什么。
8. 输出语言与用户当前输入一致。每条不超过 50 个字，只输出任务本身，不要序号、不要引号、不要解释。

只输出 JSON，不要任何其他文字：
{"items":[{"question":"…","direction":"找实现|跑复现|读代码|选型对比|接入本项目|收窄范围|要前提","anchors":["…"],"basis":"input|history|both"}],"confidence":"high|low","reason":"一句话说明你为什么这么判断，或为什么判断不了"}`
}

const PERSONAS = [
	{ id: 'dev', label: '编程', system: DEV_SYSTEM, directions: DEV_DIRECTIONS },
	{ id: 'research', label: '调研', system: RESEARCH_SYSTEM, directions: RESEARCH_DIRECTIONS },
	{ id: 'custom', label: '自定义', system: '', directions: DEV_DIRECTIONS },
]

/**
 * custom 那一档的提示词是运行时按用户自述生成的，所以在这里现算；
 * 认不出的画像退回第一条，不去猜用户想干什么。
 */
function persona(personaId, custom) {
	if (personaId === 'custom') {
		const description = custom && custom.description ? custom.description : ''
		return {
			id: 'custom',
			label: '自定义',
			system: custom && custom.system ? custom.system : customSkeleton(description),
			directions: custom && custom.directions && custom.directions.length ? custom.directions : DEV_DIRECTIONS,
			description,
		}
	}
	return PERSONAS.find((item) => item.id === personaId) ?? PERSONAS[0]
}

/** 把用户自述编译成上面那种 system prompt。契约部分写死在这里，模型只能改画像部分。 */
const COMPILE_SYSTEM = `你要把一段"用户自述"编译成一份 system prompt。产物不是给人看的回答，而是另一个模型的系统提示词：那个模型坐在 DeepSeek Harness（终端编程 agent）的输入框旁边，用户每敲几个字，它就要猜出三条用户接下来想让 agent 动手执行的任务。

编译时必须保留这些契约，一条都不能松：
- 只输出 JSON，形如 {"items":[{"question":"…","direction":"…","anchors":["…"],"basis":"input|history|both"}],"confidence":"high|low","reason":"…"}
- 三条候选方向互不相同，direction 只能逐字用它为该画像定的方向表
- 每条候选都是可执行任务（带动作和对象），不是知识问句，也不是把用户输入原样重申
- 每条自包含、还原指代；anchors 必须逐字摘自当前输入或最近对话，严禁编造
- 严禁编造仓库名、论文名、版本号、API 名，不确定就写成待核实的检索任务
- 输入已经是一条完整可执行任务时，只在能补出明显缺失约束时才给候选，否则返回空 items
- 输入很短或含指代时用【最近对话】补全；输出语言跟随用户输入；每条不超过 50 个字
- 必须包含 confidence 与 reason 的语义说明

可以由你按画像改写的是：这个人是谁、他在什么场景打字、他最可能想让 agent 做什么、以及一版贴合他领域的方向表和一条主题词示例。
directions 给 4 到 7 个，每个不超过 6 个字，必须是这个画像下真正互不相同的意图方向，且与 system 里逐字一致。
system 用中文写，不超过 900 字，不要 markdown 代码块。

只输出 JSON：{"system":"…","directions":["…","…"]}`

function parseCompiled(text) {
	const parsed = extractJson(text)
	const system = typeof parsed?.system === 'string' ? parsed.system.trim() : ''
	const directions = asStringArray(parsed?.directions)
		.map((item) => item.trim())
		.filter((item) => item && item.length <= 12)
	if (system.length < 120 || directions.length < 3) return null
	return { system, directions }
}

const HISTORY_TURNS = 6
const TURN_MAX = 700

/** turns 是 [{role:'user'|'assistant', text}]，来自宿主会话日志。 */
function buildUserBlock(input, turns) {
	const recent = (turns || []).slice(-HISTORY_TURNS)
	const transcript = recent.length
		? recent.map((m) => `${m.role === 'user' ? '用户' : '助手'}：${truncate(m.text, TURN_MAX)}`).join('\n')
		: '（暂无对话历史）'

	return ['【最近对话】', transcript, '', '【当前输入（用户还没打完）】', input, '', '请按规则输出 JSON。'].join('\n')
}

function extractJson(text) {
	const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
	try {
		return JSON.parse(trimmed)
	} catch {
		/* 模型可能带一句开场白，退而求其次抓第一个大括号块 */
	}
	const start = trimmed.indexOf('{')
	const end = trimmed.lastIndexOf('}')
	if (start >= 0 && end > start) {
		try {
			return JSON.parse(trimmed.slice(start, end + 1))
		} catch {
			return null
		}
	}
	return null
}

function asStringArray(value) {
	return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
}

// 认不出的方向标签必须归进枚举，否则同方向去重会失效；不传方向的调用（测试、旧数据）用两套预设的并集。
const ALL_DIRECTIONS = new Set([...DEV_DIRECTIONS, ...RESEARCH_DIRECTIONS])

function directionSet(directions) {
	if (directions instanceof Set) return directions
	if (Array.isArray(directions) && directions.length) return new Set(directions)
	return ALL_DIRECTIONS
}

function parseItem(raw, directions) {
	if (!raw || typeof raw !== 'object') return null
	const question = typeof raw.question === 'string' ? raw.question.trim() : ''
	if (question.length < 2) return null
	// 方向标签是去重的依据，认不出的标签必须归到枚举里，否则同义改写会漏过。
	const label = String(raw.direction ?? '').trim()
	const direction = directions.has(label) ? label : '选型对比'
	const basis = raw.basis === 'input' || raw.basis === 'history' || raw.basis === 'both' ? raw.basis : 'both'
	return { question, direction, anchors: asStringArray(raw.anchors), basis }
}

function parseSuggestionResponse(text, directionList) {
	const empty = { items: [], confidence: 'low', reason: '返回内容无法解析' }
	const parsed = extractJson(text)
	if (!parsed || typeof parsed !== 'object') return empty
	const directions = directionSet(directionList)

	const rawItems = Array.isArray(parsed.items) ? parsed.items : []
	const items = rawItems.map((raw) => parseItem(raw, directions)).filter(Boolean).slice(0, 3)
	const confidence = parsed.confidence === 'high' ? 'high' : 'low'
	const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : ''
	return { items, confidence, reason }
}

/**
 * 流式用：从半截 JSON 里捞出 items 数组中**已经闭合**的对象，让第一条候选不必等全文到齐。
 * 花括号配对时避开字符串内部，坏块跳过等下一批字节。
 */
function scanCompletedItems(buffer, directionList) {
	const directions = directionSet(directionList)
	const keyAt = buffer.indexOf('"items"')
	if (keyAt < 0) return { items: [], closed: false }
	const arrayAt = buffer.indexOf('[', keyAt)
	if (arrayAt < 0) return { items: [], closed: false }

	const items = []
	let index = arrayAt + 1
	let closed = false

	while (index < buffer.length) {
		while (index < buffer.length && buffer[index] !== '{' && buffer[index] !== ']') index += 1
		if (index >= buffer.length) break
		if (buffer[index] === ']') {
			closed = true
			break
		}

		const start = index
		let depth = 0
		let inString = false
		let escaped = false
		let end = index

		for (; end < buffer.length; end++) {
			const char = buffer[end]
			if (inString) {
				if (escaped) escaped = false
				else if (char === '\\') escaped = true
				else if (char === '"') inString = false
				continue
			}
			if (char === '"') inString = true
			else if (char === '{') depth += 1
			else if (char === '}') {
				depth -= 1
				if (depth === 0) {
					end += 1
					break
				}
			}
		}

		if (depth !== 0) break // 这条还没写完，等下一批
		index = end
		try {
			const parsed = parseItem(JSON.parse(buffer.slice(start, end)), directions)
			if (parsed) items.push(parsed)
		} catch {
			/* 半截或坏块，跳过 */
		}
	}

	return { items, closed }
}

// ---- engine/stability.js ----
/**
 * 去重。实测中文二元组相似度分不开「同义改写」和「同一话题的不同维度」
 * （前者 0.27~0.44，后者也能到 0.43），所以这里只用它拦字面重复，
 * 真正的方向区别交给 direction 标签：同一方向只留第一条。
 */
const DEDUPE_SIMILARITY = 0.72
/** 新候选和某条旧候选像这么多就沿用它的槽位，避免位置来回跳。 */
const SLOT_KEEP_SIMILARITY = 0.42

/**
 * 证据校验：模型声称候选基于当前输入，可它的 anchors 在最新文字里一个字都找不到，
 * 说明这条候选跟用户刚打的内容已经矛盾了，不能留在界面上。
 */
function consistentWithLatestText(candidate, fragment, contextText) {
	if (candidate.anchors.length === 0) {
		return (
			occursIn(fragment, candidate.question) ||
			similar(candidate.question, fragment) > 0.12 ||
			(contextText.length > 0 && similar(candidate.question, contextText) > 0.08)
		)
	}
	const inInput = candidate.anchors.some((anchor) => occursIn(anchor, fragment))
	const inHistory = candidate.anchors.some((anchor) => occursIn(anchor, contextText))
	// 声称基于当前输入、却在最新文字里找不到任何依据 → 与用户刚打的内容矛盾，丢掉
	if (candidate.basis === 'input') return inInput
	return inInput || inHistory
}

function dedupe(items) {
	const kept = []
	for (const item of items) {
		const duplicated = kept.some((existing) => similar(existing.question, item.question) >= DEDUPE_SIMILARITY)
		const sameDirection = kept.some((existing) => existing.direction === item.direction)
		if (!duplicated && !sameDirection) kept.push(item)
	}
	return kept.slice(0, 3)
}

/** 位置稳定化：语义没变的候选留在原槽位，槽位号即显示顺序。 */
function placeIntoSlots(previous, next) {
	const taken = new Set()
	const placed = []

	for (const item of next) {
		const carried = previous.find((old) => !taken.has(old.slot) && similar(old.question, item.question) >= SLOT_KEEP_SIMILARITY)
		if (carried) {
			taken.add(carried.slot)
			placed.push({ slot: carried.slot, question: carried.question, direction: item.direction })
			continue
		}
		let slot = 0
		while (taken.has(slot)) slot += 1
		taken.add(slot)
		placed.push({ slot, question: item.question, direction: item.direction })
	}

	return placed.sort((a, b) => a.slot - b.slot)
}

/** 三条需求（稳定/不矛盾/去重）合成一次提交：证据校验 → 去重 → 槽位放置。 */
function commitCandidates(candidates, fragment, contextText, previous) {
	const surviving = candidates.filter((item) => consistentWithLatestText(item, fragment, contextText))
	const deduped = dedupe(surviving)
	if (deduped.length === 0) return []
	return placeIntoSlots(previous, deduped)
}

// ---- engine/suggest.js ----
/** 宿主插件注册的转发口：同一个 provider、同一份凭据，插件不再自己配 key。 */
const CONTEXT_PATH = '/intent-suggest/context'
const SUGGEST_PATH = '/intent-suggest/suggest'

async function fetchRecentTurns(sessionId, { base = '', fetchImpl = globalThis.fetch, signal } = {}) {
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
async function streamSuggestion(payload, { base = '', fetchImpl = globalThis.fetch, signal, onItems, directions, startedAt = Date.now() } = {}) {
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
async function compilePersona(description, { base = '', fetchImpl = globalThis.fetch, signal } = {}) {
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

return { normalize, tokenize, jaccard, similar, occursIn, looksSettled, hasAnaphora, truncate, PERSONAS, persona, COMPILE_SYSTEM, parseCompiled, buildUserBlock, parseSuggestionResponse, scanCompletedItems, consistentWithLatestText, dedupe, placeIntoSlots, commitCandidates, CONTEXT_PATH, SUGGEST_PATH, fetchRecentTurns, streamSuggestion, compilePersona }
})()

	const MIN_CHARS = 2
	const DEBOUNCE_MS = 550
	const SETTLED_DEBOUNCE_MS = 220
	const MIN_REQUEST_GAP_MS = 350
	const MAX_TOKENS = 700
	const TEMPERATURE = 0.7
	const PERSONA_KEY = 'dsh-intent-suggest:persona'
	const CUSTOM_KEY = 'dsh-intent-suggest:custom-persona'
	const COMPILE_DEBOUNCE_MS = 800

	function readStoredPersona() {
		try {
			return localStorage.getItem(PERSONA_KEY) || 'dev'
		} catch {
			return 'dev'
		}
	}

	function storePersona(id) {
		try {
			localStorage.setItem(PERSONA_KEY, id)
		} catch {
			/* 隐私模式等场景写不进去，切档只活在本页 */
		}
	}

	/** 编译结果和它的输入存在一起，描述没变就不再打第二次。 */
	function readStoredCustom() {
		const empty = { description: '', system: '', directions: [], compiledFor: '' }
		try {
			const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || 'null')
			return raw && typeof raw.description === 'string' ? Object.assign(empty, raw) : empty
		} catch {
			return empty
		}
	}

	function storeCustom(custom) {
		try {
			localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom))
		} catch {
			/* 同上 */
		}
	}

	const styles = {
		row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '6px 2px 2px', fontSize: 12 },
		persona: {
			padding: 0,
			border: 0,
			background: 'transparent',
			color: 'inherit',
			font: 'inherit',
			opacity: 0.6,
			cursor: 'pointer',
		},
		meta: { opacity: 0.4, fontVariantNumeric: 'tabular-nums' },
		chip: {
			display: 'inline-flex',
			alignItems: 'center',
			gap: 6,
			maxWidth: '100%',
			padding: '3px 10px',
			border: '1px solid currentColor',
			borderRadius: 999,
			background: 'transparent',
			color: 'inherit',
			font: 'inherit',
			cursor: 'pointer',
			opacity: 0.85,
		},
		tag: { opacity: 0.55 },
		personaInput: {
			flex: '1 1 220px',
			minWidth: 160,
			padding: '3px 10px',
			border: '1px dashed currentColor',
			borderRadius: 999,
			background: 'transparent',
			color: 'inherit',
			font: 'inherit',
			opacity: 0.75,
		},
	}

	function CandidateChip({ candidate, stale, onPick }) {
		return h(
			'button',
			{
				type: 'button',
				style: Object.assign({}, styles.chip, stale ? { opacity: 0.45 } : null),
				title: '点击只会把这句填回输入框，不会替你发送',
				onMouseDown: (event) => event.preventDefault(),
				onClick: () => onPick(candidate.question),
			},
			h('span', { style: styles.tag }, candidate.direction),
			h('span', null, candidate.question),
		)
	}

	const selectDraft = (state) => state.draft

	function useSuggestions(draft, sessionId, personaView, personaKey) {
		const [items, setItems] = useState([])
		const [pending, setPending] = useState(false)
		const [generatedFor, setGeneratedFor] = useState(null)
		const [lowConfidence, setLowConfidence] = useState(false)
		const [note, setNote] = useState(null)
		const [usage, setUsage] = useState(null)
		const [timing, setTiming] = useState(null)

		const inflight = useRef(false)
		const queued = useRef(null)
		const lastPersona = useRef(personaKey)
		const lastStartedAt = useRef(0)
		const seq = useRef(0)
		const disposed = useRef(false)
		const itemsRef = useRef(items)
		const draftRef = useRef(draft)
		const sessionRef = useRef(sessionId)
		const personaRef = useRef(personaView)
		itemsRef.current = items
		draftRef.current = draft
		sessionRef.current = sessionId
		personaRef.current = personaView

		useEffect(() => {
			disposed.current = false
			return () => {
				disposed.current = true
			}
		}, [])

		const run = useCallback(async (fragment) => {
			const mySeq = ++seq.current
			inflight.current = true
			lastStartedAt.current = Date.now()
			setPending(true)

			let contextText = ''
			/** 增量和最终结果走同一条通路：证据校验 → 去重 → 槽位放置。 */
			const commit = (candidates) => {
				if (disposed.current || mySeq !== seq.current) return 0
				const placed = engine.commitCandidates(candidates, fragment, contextText, itemsRef.current)
				if (placed.length === 0) return 0
				itemsRef.current = placed
				setItems(placed)
				setGeneratedFor(fragment)
				return placed.length
			}

			try {
				const view = personaRef.current
				const turns = await engine.fetchRecentTurns(sessionRef.current, { signal: undefined })
				contextText = turns.map((turn) => turn.text).join('\n')
				const payload = {
					system: view.system,
					messages: [{ role: 'user', content: [{ type: 'text', text: engine.buildUserBlock(fragment, turns) }] }],
					maxTokens: MAX_TOKENS,
					temperature: TEMPERATURE,
				}
				const outcome = await engine.streamSuggestion(payload, { onItems: commit, directions: view.directions, startedAt: lastStartedAt.current })
				if (disposed.current || mySeq !== seq.current) return

				const parsed = engine.parseSuggestionResponse(outcome.text, view.directions)
				const kept = commit(parsed.items)
				setUsage(outcome.usage)
				setTiming({ latencyMs: outcome.latencyMs, firstItemMs: outcome.firstItemMs })

				if (kept === 0) {
					// 一条都不剩：清空，而不是留着跟最新文字对不上的旧候选
					itemsRef.current = []
					setItems([])
					setGeneratedFor(null)
					setLowConfidence(false)
					setNote(parsed.reason ? `信息不足，暂不显示：${engine.truncate(parsed.reason, 70)}` : '信息不足，暂不显示')
					return
				}
				setLowConfidence(parsed.confidence === 'low')
				setNote(parsed.confidence === 'low' && parsed.reason ? `依据不足，纯猜：${engine.truncate(parsed.reason, 70)}` : null)
			} catch (error) {
				if (disposed.current || mySeq !== seq.current) return
				setNote(`出错了：${engine.truncate(error && error.message ? error.message : String(error), 70)}`)
			} finally {
				inflight.current = false
				if (mySeq === seq.current && !disposed.current) setPending(false)
				const next = queued.current
				queued.current = null
				if (next && !disposed.current) void run(next)
			}
		}, [])

		useEffect(() => {
			const fragment = engine.normalize(draft)
			if (fragment.length < MIN_CHARS) {
				if (itemsRef.current.length) {
					itemsRef.current = []
					setItems([])
				}
				setGeneratedFor(null)
				setLowConfidence(false)
				setNote(null)
				lastPersona.current = personaKey
				return
			}
			// 换画像后旧候选是另一套提示词产的，清掉重生成，而不是灰在那里
			if (personaKey !== lastPersona.current) {
				lastPersona.current = personaKey
				itemsRef.current = []
				setItems([])
				setGeneratedFor(null)
				setNote(null)
			}

			const timer = setTimeout(() => {
				if (inflight.current || Date.now() - lastStartedAt.current < MIN_REQUEST_GAP_MS) {
					queued.current = fragment
					return
				}
				void run(fragment)
			}, engine.looksSettled(fragment) ? SETTLED_DEBOUNCE_MS : DEBOUNCE_MS)

			return () => clearTimeout(timer)
		}, [draft, sessionId, personaKey, run])

		const stale = generatedFor !== null && generatedFor !== engine.normalize(draft)
		return { items, pending, stale, lowConfidence, note, usage, timing }
	}

	function SuggestionDock(props) {
		const draft = props.useInput(selectDraft)
		const [personaId, setPersonaId] = useState(readStoredPersona)
		const [custom, setCustom] = useState(readStoredCustom)
		const [compiling, setCompiling] = useState(false)
		const [compileError, setCompileError] = useState(null)

		const personaView = engine.persona(personaId, custom)
		/** 编译完成会让同一句描述换一套 system，用它当"画像变了、旧候选作废"的信号。 */
		const personaKey = `${personaId}|${custom.description}|${personaView.system.length}`
		const view = useSuggestions(draft, props.sessionId, personaView, personaKey)

		useEffect(() => storeCustom(custom), [custom])

		// 停笔后才编译一次；描述没换就不重复打 API
		useEffect(() => {
			const description = custom.description.trim()
			if (personaId !== 'custom' || !description || description === custom.compiledFor) return
			const timer = setTimeout(() => {
				setCompiling(true)
				setCompileError(null)
				engine
					.compilePersona(description)
					.then((compiled) => setCustom({ description, system: compiled.system, directions: compiled.directions, compiledFor: description }))
					.catch((error) => setCompileError(error && error.message ? error.message : String(error)))
					.finally(() => setCompiling(false))
			}, COMPILE_DEBOUNCE_MS)
			return () => clearTimeout(timer)
		}, [personaId, custom])

		const editingPersona = personaId === 'custom'
		if (!editingPersona && view.items.length === 0 && !view.pending && !view.note) return null

		const personaName = personaView.label
		const nextPersona = engine.PERSONAS[(engine.PERSONAS.findIndex((item) => item.id === personaId) + 1) % engine.PERSONAS.length]

		const fill = (text) => {
			if (props.inputActions) props.inputActions.setDraft(text)
		}

		const cyclePersona = () => {
			storePersona(nextPersona.id)
			setPersonaId(nextPersona.id)
		}

		// 这行讲的是自定义画像，切到另外两档就不该露出来
		const personaNote = !editingPersona
			? null
			: compiling
				? '正在按这句画像生成提示词…'
				: compileError
					? `生成失败：${engine.truncate(compileError, 60)}`
					: custom.compiledFor
						? `已生成 · 方向 ${custom.directions.join(' / ')}`
						: custom.description.trim()
							? '还没生成，先用通用规则兜底'
							: null

		return h(
			'div',
			{ style: styles.row, 'data-dsh-intent-suggest': 'dock' },
			h(
				'button',
				{
					type: 'button',
					style: styles.persona,
					title: `当前画像：${personaName} · 点击换成${nextPersona.label}`,
					onMouseDown: (event) => event.preventDefault(),
					onClick: cyclePersona,
				},
				`你可能想让它做 · ${personaName}`,
			),
			editingPersona
				? h('input', {
						style: styles.personaInput,
						value: custom.description,
						placeholder: '用一句话说你是谁、平时让 agent 干什么',
						onChange: (event) => setCustom(Object.assign({}, custom, { description: event.target.value })),
					})
				: null,
			personaNote ? h('span', { style: styles.meta, 'data-persona-note': '1' }, personaNote) : null,
			...view.items.map((candidate) =>
				h(CandidateChip, { key: candidate.slot, candidate, stale: view.stale, onPick: fill }),
			),
			view.pending && !view.items.length ? h('span', { style: styles.meta }, '在想…') : null,
			view.note ? h('span', { style: styles.meta, 'data-note': '1' }, view.note) : null,
			view.timing
				? h(
						'span',
						{ style: styles.meta, title: '首条候选上屏 / 全量返回 · 输入输出 token' },
						`${view.timing.firstItemMs ?? '—'}ms ↑${view.timing.latencyMs}ms · ${view.usage ? `${view.usage.inputTokens}/${view.usage.outputTokens}` : '—'}`,
					)
				: null,
		)
	}

	function install(ctx) {
		ctx.slots.inject('conversation.input.dock', () =>
			ctx.slots.register(
				{
					name: 'conversation.input.dock',
					id: 'dsh-intent-suggest',
					order: 20,
					inject: (sessionId) => ({ sessionId }),
				},
				SuggestionDock,
			),
		)
	}

	function apply(ctx) {
		if (typeof ctx.inject === 'function') ctx.inject(['conversation'], (host) => install(host))
		else install(ctx)
	}

	exports.name = 'dsh-intent-suggest'
	exports.inject = ['slots']
	exports.apply = apply
	return module.exports
} })
