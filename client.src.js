window.__ModuleLoader__.load({ id: 'dsh-intent-suggest', factory: (require) => {
	const module = { exports: {} }
	const exports = module.exports
	Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

	const react = require('react')
	const h = react.createElement
	const { useCallback, useEffect, useRef, useState } = react

	const engine = /*@@ENGINE@@*/

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
