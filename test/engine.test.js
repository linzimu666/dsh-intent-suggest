import test from 'node:test'
import assert from 'node:assert/strict'

import { normalize, similar, occursIn, looksSettled, hasAnaphora } from '../engine/text.js'
import { buildUserBlock, parseCompiled, parseSuggestionResponse, persona, scanCompletedItems } from '../engine/prompt.js'
import { commitCandidates, dedupe, placeIntoSlots, consistentWithLatestText } from '../engine/stability.js'

const item = (question, direction = '读代码', extra = {}) => ({ question, direction, anchors: [], basis: 'both', ...extra })

test('五条需求各自的机器', () => {
	// 需求 4：位置稳定
	const placed = placeIntoSlots(
		[
			{ slot: 0, question: 'git rebase 会改写历史吗', direction: '读代码' },
			{ slot: 1, question: '如何用 rebase 整理提交', direction: '跑复现' },
		],
		[item('如何用 rebase 整理提交', '跑复现'), item('rebase 之后怎么强推', '要前提')],
	)
	assert.deepEqual(
		placed.map((c) => c.slot),
		[0, 1],
		'语义没变的候选应留在原槽位',
	)
	assert.equal(placed[1].question, '如何用 rebase 整理提交', '沿用旧候选的那条要停在原槽位')
	assert.equal(placed[0].question, 'rebase 之后怎么强推')

	// 需求 2：同义改写与同方向都要压掉
	assert.equal(dedupe([item('git rebase 怎么用'), item('git rebase 怎么使用'), item('rebase 和 merge 的区别', '选型对比')]).length, 2)
	assert.equal(dedupe([item('甲的问题', '跑复现'), item('完全不同的乙问题', '跑复现')]).length, 1, '同一方向只留第一条')

	// 需求 4：与最新输入矛盾的候选不能留
	assert.equal(consistentWithLatestText(item('Docker 容器怎么 limit 内存', '读代码', { anchors: ['Docker'], basis: 'input' }), 'git rebase', ''), false)
	assert.equal(consistentWithLatestText(item('git rebase 卡住了怎么办', '读代码', { anchors: ['rebase'], basis: 'input' }), 'git rebase', ''), true)
	assert.equal(commitCandidates([item('无关问题', '读代码', { anchors: ['无关'], basis: 'input' })], 'git rebase', '', []).length, 0)

	// 需求 3：指代 + 上下文
	assert.equal(hasAnaphora('那这个呢'), true)
	assert.ok(similar('那这个呢', '那这个呢') === 1)
	assert.ok(buildUserBlock('那这个呢', [{ role: 'assistant', text: 'rebase 会重写提交历史' }]).includes('助手：rebase 会重写提交历史'))

	// 需求 1 的地基：文本工具
	assert.equal(normalize('  a   b  '), 'a b')
	assert.equal(occursIn('rebase', 'git  REBASE 一下'), true)
	assert.equal(looksSettled('git rebase 怎么用？'), true)
	assert.equal(looksSettled('git rebase'), false)
})

test('流式半截 JSON 逐条出候选', () => {
	const full = '{"items":[{"question":"git rebase 会改写历史吗","direction":"读代码","anchors":["rebase"],"basis":"input"},{"question":"和 merge 怎么选","direction":"选型对比","anchors":[],"basis":"both"}],"confidence":"high","reason":"ok"}'
	const seen = []
	for (let cut = 0; cut <= full.length; cut++) {
		const scanned = scanCompletedItems(full.slice(0, cut))
		if (scanned.items.length > seen.length) seen.push(scanned.items.map((x) => x.question))
	}
	assert.equal(seen.length, 2, '两条候选应在不同时刻分别闭合')
	assert.deepEqual(seen[0], ['git rebase 会改写历史吗'])
	assert.equal(seen[1].length, 2)

	// 字符串里的花括号不能骗过配对
	const tricky = '{"items":[{"question":"这题有个 } 号","direction":"读代码","anchors":[],"basis":"input"}],"confidence":"low","reason":"r"}'
	const scanned = scanCompletedItems(tricky)
	assert.equal(scanned.items.length, 1)
	assert.equal(scanned.items[0].question, '这题有个 } 号')

	// 认不出的方向标签必须归入枚举，否则同方向去重会失效
	assert.equal(parseSuggestionResponse('{"items":[{"question":"一个问题","direction":"随便写的","anchors":[],"basis":"nope"}]}').items[0].direction, '选型对比')
	assert.deepEqual(scanCompletedItems('{"items":[').items, [])
	assert.equal(parseSuggestionResponse('模型说了句人话').items.length, 0)
})

test('画像只换提示词，方向标签两套都要认', () => {
	assert.notEqual(persona('research').system, persona('dev').system)
	assert.equal(persona('不存在的画像').id, 'dev', '认不出的画像退回默认，不是猜一个')
	// 调研画像的方向必须过 parseItem，否则会被归一到"选型对比"、同方向去重就废了
	const items = parseSuggestionResponse('{"items":[{"question":"检索近三年果蝇全脑建模的开源工作","direction":"找论文","anchors":["果蝇"],"basis":"input"},{"question":"找出各自用的数据集","direction":"找数据","anchors":["果蝇"],"basis":"input"}]}', persona('research').directions).items
	assert.deepEqual(
		items.map((x) => x.direction),
		['找论文', '找数据'],
	)
	assert.equal(dedupe(items).length, 2, '两个不同方向都该留下')
})

test('自定义画像：描述进兜底提示词，编译结果覆盖方向和 system', () => {
	const bare = persona('custom', { description: '我做单细胞测序，平时让 agent 写 R 脚本' })
	assert.ok(bare.system.includes('单细胞测序'), '没编译出来时也要按描述兜底，不能空白')
	assert.deepEqual(bare.directions, persona('dev').directions)

	const compiled = persona('custom', { description: 'x', system: '生成出来的提示词', directions: ['查日志', '比版本'] })
	assert.equal(compiled.system, '生成出来的提示词')
	// 自定义方向必须逐字过 parseItem，否则同方向去重会把三条压成两条
	const items = parseSuggestionResponse('{"items":[{"question":"查一下线上日志的报错分布","direction":"查日志","anchors":[],"basis":"input"},{"question":"比较两个版本的接口差异","direction":"比版本","anchors":[],"basis":"input"}]}', compiled.directions).items
	assert.deepEqual(
		items.map((x) => x.direction),
		['查日志', '比版本'],
	)
	assert.deepEqual(
		parseSuggestionResponse('{"items":[{"question":"查一下线上日志的报错分布","direction":"查日志","anchors":[],"basis":"input"}]}').items[0].direction,
		'选型对比',
		'不在当前画像方向表里的标签要归一',
	)

	assert.equal(parseCompiled('{"system":"太短","directions":["a","b","c"]}'), null, 'system 太短视为没生成成功')
	assert.equal(parseCompiled('{"system":"够长够长够长够长够长够长够长够长够长够长够长够长够长够长够长够长够长够长够长够长够长够长够长","directions":["a","b"]}'), null, '方向少于 3 个不采纳')
	const ok = parseCompiled('{"system":"' + '够'.repeat(130) + '","directions":["查日志","比版本","跑一遍","要前提"]}')
	assert.equal(ok.directions.length, 4)
})
