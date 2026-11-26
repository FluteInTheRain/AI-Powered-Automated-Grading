// Pure helpers for the question picker: filter, sort and list the categories of a problem list.
export const DIFFICULTY_LABEL = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' }
const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2 }

const byTitle = (a, b) => a.title.localeCompare(b.title)
const asc = {
  title: byTitle,
  difficulty: (a, b) => DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty] || byTitle(a, b),
  category: (a, b) => a.category.localeCompare(b.category) || byTitle(a, b),
}

/** Empty search, category or difficulty means "no filter". */
export function filterProblems(problems, { search = '', category = '', difficulty = '' } = {}) {
  const needle = search.trim().toLowerCase()
  return problems.filter(
    (p) => (!needle || p.title.toLowerCase().includes(needle))
      && (!category || p.category === category)
      && (!difficulty || p.difficulty === difficulty),
  )
}

/**
 * Sorted copy. `dir` is 'asc' or 'desc'. `selected` puts the chosen problems first (asc) or last (desc); `weight` orders the chosen
 * problems by their weight and always keeps the unchosen ones last. `chosen` maps problem id -> weight (string or number).
 */
export function sortProblems(problems, key, dir = 'asc', chosen = {}) {
  const sign = dir === 'desc' ? -1 : 1
  const isChosen = (p) => p.id in chosen
  let compare
  if (key === 'selected') {
    compare = (a, b) => sign * (Number(isChosen(b)) - Number(isChosen(a))) || byTitle(a, b)
  } else if (key === 'weight') {
    compare = (a, b) => {
      if (!isChosen(a) || !isChosen(b)) return Number(isChosen(b)) - Number(isChosen(a)) || byTitle(a, b)
      return sign * (Number(chosen[a.id]) - Number(chosen[b.id])) || byTitle(a, b)
    }
  } else {
    const base = asc[key] ?? byTitle
    compare = (a, b) => sign * base(a, b)
  }
  return [...problems].sort(compare)
}

export const categoriesOf = (problems) => [...new Set(problems.map((p) => p.category))].sort((a, b) => a.localeCompare(b))
