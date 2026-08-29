import { useReview } from '../store'
import { btn } from '../ui'

/**
 * Light or dark, next to settings on every page that has a settings link.
 *
 * It is also in Settings → Appearance, and stays there: that is where someone
 * goes to read what the choice means. This is for the other case — the sun came
 * out, or it did not — where opening a settings page to flip one switch is four
 * clicks for a decision that takes none.
 */
export function ThemeToggle() {
  const theme = useReview((s) => s.theme)
  const toggleTheme = useReview((s) => s.toggleTheme)
  const dark = theme === 'dark'

  return (
    <button
      className={`shrink-0 ${btn()}`}
      title={dark ? 'switch to the light theme' : 'switch to the dark theme'}
      aria-label={dark ? 'switch to the light theme' : 'switch to the dark theme'}
      onClick={toggleTheme}
    >
      {dark ? '☀' : '☾'}
    </button>
  )
}
