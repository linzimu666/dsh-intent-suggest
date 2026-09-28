export function normalize(value) {
	return String(value ?? '').trim().replace(/\s+/g, ' ')
}

const CJK_RUN = /[㐀-䶿一-鿿぀-ヿ가-힯]+/g
const LATIN_WORD = /[a-z0-9]+/g

/** 拉丁词按空格切，中日韩按二元组切——够用来判断"两条候选是不是一回事"。 */
export function tokenize(value) {
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

export function jaccard(a, b) {
	if (a.size === 0 || b.size === 0) return 0
	let shared = 0
	for (const token of a) if (b.has(token)) shared += 1
	return shared / (a.size + b.size - shared)
}

export function similar(a, b) {
	return jaccard(tokenize(a), tokenize(b))
}

export function occursIn(needle, haystack) {
	const n = normalize(needle).toLowerCase()
	if (!n) return false
	return normalize(haystack).toLowerCase().includes(n)
}

/** 以句号/问号等收尾说明这一句已经"成型"，可以更早出候选。 */
export function looksSettled(value) {
	return /[？?。！!；;]\s*$/.test(String(value ?? '').trim())
}

const ANAPHORA = ['那这个', '这个呢', '那个呢', '换成', '改成', '如果换', '那它', '他们', '上面', '刚才', '同样', '这', '那', '它']

/** "那这个呢"——单看当前输入无法理解，必须靠上下文。 */
export function hasAnaphora(value) {
	return ANAPHORA.some((token) => String(value ?? '').includes(token))
}

export function truncate(value, max) {
	const s = String(value ?? '')
	return s.length <= max ? s : s.slice(0, max) + '…'
}
