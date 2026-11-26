import { describe, expect, it } from 'vitest'
import { categoriesOf, filterProblems, sortProblems } from '../src/catalog.js'

const P = (id, title, category, difficulty) => ({ id, title, category, difficulty })
const list = [
  P('1', 'Two Sum', 'Arrays & Search', 'medium'),
  P('2', 'Is Prime', 'Math', 'easy'),
  P('3', 'Reverse a String', 'Strings', 'easy'),
  P('4', 'Binary Search', 'Arrays & Search', 'hard'),
  P('5', 'Factorial', 'Math', 'easy'),
]
const ids = (xs) => xs.map((p) => p.id)

describe('filterProblems', () => {
  it('matches the title as a case-insensitive trimmed substring', () => {
    expect(ids(filterProblems(list, { search: '  sEARch ' }))).toEqual(['4'])
    expect(ids(filterProblems(list, { search: 'prime' }))).toEqual(['2'])
  })
  it('empty search, category and difficulty mean no filter', () => {
    expect(filterProblems(list, { search: '', category: '', difficulty: '' })).toHaveLength(5)
    expect(filterProblems(list, {})).toHaveLength(5)
  })
  it('combines search, category and difficulty', () => {
    expect(ids(filterProblems(list, { category: 'Math', difficulty: 'easy' }))).toEqual(['2', '5'])
    expect(ids(filterProblems(list, { category: 'Arrays & Search', difficulty: 'hard' }))).toEqual(['4'])
    expect(ids(filterProblems(list, { category: 'Math', search: 'fact' }))).toEqual(['5'])
    expect(filterProblems(list, { category: 'Math', difficulty: 'hard' })).toEqual([])
  })
})

describe('sortProblems', () => {
  it('sorts by title', () => {
    expect(ids(sortProblems(list, 'title'))).toEqual(['4', '5', '2', '3', '1'])
  })
  it('sorts by difficulty (easy, medium, hard) then title', () => {
    expect(ids(sortProblems(list, 'difficulty'))).toEqual(['5', '2', '3', '1', '4'])
  })
  it('sorts by category then title', () => {
    expect(ids(sortProblems(list, 'category'))).toEqual(['4', '1', '5', '2', '3'])
  })
  it('returns a new array and leaves the input alone', () => {
    const copy = [...list]
    const out = sortProblems(list, 'title')
    expect(out).not.toBe(list)
    expect(list).toEqual(copy)
  })
})

describe('categoriesOf', () => {
  it('lists each category once, sorted', () => {
    expect(categoriesOf(list)).toEqual(['Arrays & Search', 'Math', 'Strings'])
  })
})
