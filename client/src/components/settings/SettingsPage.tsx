import { Link, useLocation, useNavigate } from 'react-router'
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
import { useSettings } from './useSettings'
import { Loading, Skeleton, SkeletonLines } from '../Skeleton'
import { btn, enter, motion } from '../../ui'

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
  const location = useLocation()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2.5 px-4 py-2.5 text-xs">
        <img src="/stickie.svg" alt="" className="h-4.5 w-4.5" />
        <span className="font-semibold tracking-tight text-ink">stickie</span>
        <span className="text-faint">settings</span>
        <span className="grow" />
        {/*
          Back where the reader was, not to the root: settings is reached from a
          review, from the overview, and from a pasted address, and only the
          last of those has nowhere to go back to. `location.key` is 'default'
          for the entry a page was loaded on, which is how that case is known.
        */}
        <button
          className={btn()}
          onClick={() => {
            if (location.key === 'default') void navigate('/')
            else void navigate(-1)
          }}
        >
          back
        </button>
      </header>
      <div className="flex min-h-0 grow">
        <nav className="w-48 shrink-0 space-y-0.5 px-2 py-3">
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
        <div className={`min-h-0 grow overflow-y-auto p-6 ${enter}`}>
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
