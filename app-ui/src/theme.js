import { useSyncExternalStore } from 'react'

// The theme lives on <html data-theme>; index.html sets it before the first paint to avoid a flash.
const listeners = new Set()
const read = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  try {
    localStorage.setItem('theme', theme)
  } catch {
    /* storage can be blocked; the choice then lasts until the page closes */
  }
  listeners.forEach((fn) => fn())
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, read, () => 'light')
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')]
}
