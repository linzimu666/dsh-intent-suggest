import { truncate } from './text.js'

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

export const PERSONAS = [
	{ id: 'dev', label: '编程', system: DEV_SYSTEM, directions: DEV_DIRECTIONS },
	{ id: 'research', label: '调研', system: RESEARCH_SYSTEM, directions: RESEARCH_DIRECTIONS },
	{ id: 'custom', label: '自定义', system: '', directions: DEV_DIRECTIONS },
]

/**
 * custom 那一档的提示词是运行时按用户自述生成的，所以在这里现算；
 * 认不出的画像退回第一条，不去猜用户想干什么。
 */
export function persona(personaId, custom) {
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
export const COMPILE_SYSTEM = `你要把一段"用户自述"编译成一份 system prompt。产物不是给人看的回答，而是另一个模型的系统提示词：那个模型坐在 DeepSeek Harness（终端编程 agent）的输入框旁边，用户每敲几个字，它就要猜出三条用户接下来想让 agent 动手执行的任务。

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

export function parseCompiled(text) {
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
export function buildUserBlock(input, turns) {
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

export function parseSuggestionResponse(text, directionList) {
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
export function scanCompletedItems(buffer, directionList) {
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
