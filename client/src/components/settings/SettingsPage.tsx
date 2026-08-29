import { Link } from 'react-router'
import type { SettingsSection } from '../../routes'
import { formatRoute, settings_sections } from '../../routes'
import { AgentsSection } from './AgentsSection'
import { AppearanceSection } from './AppearanceSection'
import { GitLabSection } from './GitLabSection'
import { IdentitySection } from './IdentitySection'
import { PromptSection } from './PromptSection'
import { ReviewsSection } from './ReviewsSection'
import { StorageSection } from './StorageSection'
import { useSettings } from './useSettings'

const titles: Record<SettingsSection, string> = {
  identity: 'Identity',
  reviews: 'Reviews',
  storage: 'Storage',
  gitlab: 'GitLab',
  prompt: 'Copy prompt',
  appearance: 'Appearance',
  agents: 'Agents',
}

const sections: Record<
  SettingsSection,
  (access: ReturnType<typeof useSettings>) => React.ReactElement
> = {
  identity: (access) => <IdentitySection {...access} />,
  reviews: (access) => <ReviewsSection {...access} />,
  storage: (access) => <StorageSection {...access} />,
  gitlab: (access) => <GitLabSection {...access} />,
  prompt: (access) => <PromptSection {...access} />,
  appearance: (access) => <AppearanceSection {...access} />,
  agents: (access) => <AgentsSection {...access} />,
}

export function SettingsPage({ section }: { section: SettingsSection }) {
  const access = useSettings()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-edge px-3 py-2 text-xs">
        <img src="/stickie.svg" alt="" className="h-4.5 w-4.5" />
        <span className="font-bold tracking-wide text-ink">stickie</span>
        <span className="text-faint">settings</span>
        <span className="grow" />
        <Link
          className="rounded border border-edge px-2 py-1 text-soft hover:text-ink"
          to="/"
        >
          back to the review
        </Link>
      </header>
      <div className="flex min-h-0 grow">
        <nav className="w-48 shrink-0 border-r border-edge py-3">
          {settings_sections.map((name) => (
            <Link
              key={name}
              to={formatRoute({ kind: 'settings', section: name })}
              className={`block px-3 py-1.5 text-xs ${
                name === section
                  ? 'border-l-2 border-accent bg-overlay font-medium text-ink'
                  : 'border-l-2 border-transparent text-soft hover:text-ink'
              }`}
            >
              {titles[name]}
            </Link>
          ))}
        </nav>
        <div className="min-h-0 grow overflow-y-auto p-6">
          {sections[section](access)}
        </div>
      </div>
    </div>
  )
}
