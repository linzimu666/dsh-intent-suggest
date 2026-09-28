import { occursIn, similar } from './text.js'

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
export function consistentWithLatestText(candidate, fragment, contextText) {
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

export function dedupe(items) {
	const kept = []
	for (const item of items) {
		const duplicated = kept.some((existing) => similar(existing.question, item.question) >= DEDUPE_SIMILARITY)
		const sameDirection = kept.some((existing) => existing.direction === item.direction)
		if (!duplicated && !sameDirection) kept.push(item)
	}
	return kept.slice(0, 3)
}

/** 位置稳定化：语义没变的候选留在原槽位，槽位号即显示顺序。 */
export function placeIntoSlots(previous, next) {
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
export function commitCandidates(candidates, fragment, contextText, previous) {
	const surviving = candidates.filter((item) => consistentWithLatestText(item, fragment, contextText))
	const deduped = dedupe(surviving)
	if (deduped.length === 0) return []
	return placeIntoSlots(previous, deduped)
}
