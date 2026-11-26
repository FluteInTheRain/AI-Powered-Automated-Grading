import { useTheme } from '../theme.js'
import Icon from './Icon.jsx'

export default function ThemeToggle() {
  const [theme, toggle] = useTheme()
  return (
    <button type="button" className="ibtn" onClick={toggle} aria-label="Đổi giao diện sáng hoặc tối" title={theme === 'dark' ? 'Chuyển sang sáng' : 'Chuyển sang tối'}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  )
}
