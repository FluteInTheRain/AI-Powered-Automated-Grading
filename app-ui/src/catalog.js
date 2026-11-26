// Pure helpers for the question picker: filter, sort and list the categories of a problem list.
export const DIFFICULTY_LABEL = { easy: 'Dễ', medium: 'Vừa', hard: 'Khó' }
const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2 }

const byTitle = (a, b) => a.title.localeCompare(b.title)
const COMPARATORS = {
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

export const sortProblems = (problems, key) => [...problems].sort(COMPARATORS[key] ?? byTitle)

export const categoriesOf = (problems) => [...new Set(problems.map((p) => p.category))].sort((a, b) => a.localeCompare(b))
