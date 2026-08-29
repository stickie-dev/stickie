import { Link, useNavigate } from 'react-router'
import type { SettingsSection } from '../../routes'
import { formatRoute, settings_sections } from '../../routes'
import { AgentsSection } from './AgentsSection'
import { AppSection } from './AppSection'
import { AppearanceSection } from './AppearanceSection'
import { GitLabSection } from './GitLabSection'
import { IdentitySection } from './IdentitySection'
import { PromptSection } from './PromptSection'
import { ReviewsSection } from './ReviewsSection'
import { StorageSection } from './StorageSection'
import { ThemeToggle } from '../ThemeToggle'
import { useSettings } from './useSettings'
import { Loading, Skeleton, SkeletonLines } from '../Skeleton'
import { ArrowLeft } from '../../icons'
import { enter, icon_button, motion, page, title_bar } from '../../ui'
import { lastPlace } from '../../lastPlace'

const titles: Record<SettingsSection, string> = {
  identity: 'Identity',
  reviews: 'Reviews',
  storage: 'Storage',
  gitlab: 'GitLab',
  prompt: 'Copy prompt',
  appearance: 'Appearance',
  agents: 'Agents',
  app: 'App',
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
  app: () => <AppSection />,
}

export function SettingsPage({ section }: { section: SettingsSection }) {
  const access = useSettings()
  const navigate = useNavigate()

  return (
    <div className="min-h-full">
      <header className={`sticky top-0 z-10 py-2.5 text-xs ${title_bar}`}>
        <div className={`flex items-center gap-2.5 ${page}`}>
        <img src="/stickie.svg" alt="" className="h-4.5 w-4.5" />
        <span className="font-semibold tracking-tight text-ink">stickie</span>
        <span className="text-faint">settings</span>
        <span className="grow" />
        {/*
          Back to what the reader was looking at, which is not the same as one
          step back in history: every settings section is an address, so history
          walks Identity, Storage, GitLab before it ever leaves the page.
          `lastPlace` is the last address that was not settings, and '/' when
          settings was loaded directly.
        */}
        <ThemeToggle />
        <button
          className={icon_button}
          title="back to what you were looking at"
          aria-label="back to what you were looking at"
          onClick={() => void navigate(lastPlace())}
        >
          <ArrowLeft />
        </button>
        </div>
      </header>
      {/* the same frame as the overview, so the left edge does not move when a
          reader comes here from it */}
      <div className={`flex ${page}`}>
        {/* sticky, since the page scrolls as one now and a section can be
            taller than the window */}
        <nav className="sticky top-12 h-fit w-48 shrink-0 space-y-0.5 py-3">
          {settings_sections.map((name) => (
            <Link
              key={name}
              to={formatRoute({ kind: 'settings', section: name })}
              className={`block rounded-md px-3 py-1.5 text-xs ${motion} ${
                name === section
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-soft hover:bg-overlay hover:text-ink'
              }`}
            >
              {titles[name]}
            </Link>
          ))}
        </nav>
        <div className={`grow px-6 pt-2 pb-10 ${enter}`}>
          {/*
            Sections render their own fields empty until the settings land,
            which reads as a page of blank controls. One silhouette of a
            section, until there is something in them.
          */}
          {access.state === null && section !== 'app' ? (
            <Loading what="settings">
              <div className="max-w-2xl space-y-6">
                <Skeleton w="w-40" h="h-4" />
                <SkeletonLines lines={2} />
                {[0, 1].map((field) => (
                  <div key={field} className="space-y-2">
                    <Skeleton w="w-28" h="h-3" />
                    <Skeleton h="h-8" rounded="rounded-md" />
                    <Skeleton w="w-2/3" h="h-2.5" />
                  </div>
                ))}
              </div>
            </Loading>
          ) : (
            sections[section](access)
          )}
        </div>
      </div>
    </div>
  )
}
