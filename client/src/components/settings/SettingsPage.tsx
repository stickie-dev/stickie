import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
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
import { enter, motion, page } from '../../ui'

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
  app: (access) => <AppSection {...access} />,
}

/** Where a section starts, for the anchor and for the observer alike. */
const anchor = (name: SettingsSection) => `settings-${name}`

/**
 * Settings is one page with eight sections on it, rather than eight pages.
 *
 * Each section is still an address — a link to /settings/gitlab lands on
 * GitLab, and so does the menu — but the address now says where the page was
 * *asked* to go rather than what is rendered. Reading settings means reading
 * across them ("is this in Reviews or in Copy prompt?"), and answering that by
 * clicking through eight screens is worse than scrolling one.
 *
 * The list on the left is anchors: clicking one scrolls to its section, and
 * scrolling moves the highlight. The highlight is state and not the address,
 * which is the whole trick — an address driven by scrolling fights the
 * scrolling it was driven by, because a click sets it, the animation crosses
 * three sections on its way, and each crossing sets it again. Links replace
 * rather than push, so a page you scrolled through does not become eight
 * entries of history between you and the review you came from.
 */
export function SettingsPage({ section }: { section: SettingsSection }) {
  const access = useSettings()
  const loading = access.state === null

  /** Which anchor is lit. The scroll owns this; the address only starts it. */
  const [current, setCurrent] = useState<SettingsSection>(section)

  const goTo = (name: SettingsSection, jump = false) => {
    setCurrent(name)
    document.getElementById(anchor(name))?.scrollIntoView({
      behavior: jump ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  /*
   * The address arriving: on load it is where to start, and afterwards it is
   * the menu, a link, or the browser's own back. Waits for the sections to be
   * real, since a skeleton's anchors are in the wrong places.
   */
  const landed = useRef(false)
  useEffect(() => {
    if (loading) return
    const jump = !landed.current
    landed.current = true
    goTo(section, jump)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, loading])

  // and then the scroll takes over
  useEffect(() => {
    if (loading) return
    const seen = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) seen.add(entry.target.id)
          else seen.delete(entry.target.id)
        }
        // the topmost of whatever is in the band, so the section you are
        // reading holds the highlight rather than the one below it
        const first = settings_sections.find((name) => seen.has(anchor(name)))
        if (first !== undefined) setCurrent(first)
      },
      // a band under the header: what is at the top of the page is what is
      // being read, not whatever happens to be visible at the bottom of it
      { rootMargin: '-72px 0px -60% 0px' },
    )
    for (const name of settings_sections) {
      const element = document.getElementById(anchor(name))
      if (element !== null) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [loading])

  return (
    <div className="min-h-full">
      {/* a tab now: the app's bar is above it, and closing the tab is the way
          back. The same frame as the overview, so the left edge does not move
          when a reader goes from one to the other */}
      <div className={`flex ${page}`}>
        {/* sticky, since the page scrolls as one now and a section can be
            taller than the window */}
        <nav className="sticky top-0 h-fit w-48 shrink-0 space-y-0.5 py-3">
          {settings_sections.map((name) => (
            <Link
              key={name}
              replace
              to={formatRoute({ kind: 'settings', section: name })}
              // the address may already say this section — the reader can have
              // scrolled away from it since — so the scroll is not left to the
              // effect that watches the address
              onClick={() => goTo(name)}
              className={`block rounded-md px-3 py-1.5 text-xs ${motion} ${
                name === current
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-soft hover:bg-overlay hover:text-ink'
              }`}
            >
              {titles[name]}
            </Link>
          ))}
        </nav>
        {/*
          The tail of the page is empty on purpose: without it the last section
          cannot reach the top of the window, so its anchor would scroll to a
          stop halfway and never take the highlight. `min-w-0`, or a long
          command in a section widens the page instead of scrolling in its box.
        */}
        <div className={`min-w-0 grow px-6 pt-2 pb-[45vh] ${enter}`}>
          {/*
            Sections render their own fields empty until the settings land,
            which reads as a page of blank controls. One silhouette of a
            section, until there is something in them.
          */}
          {loading ? (
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
            <div className="space-y-12">
              {settings_sections.map((name) => (
                // the anchor clears the sticky header, so a section scrolled
                // to starts below it rather than under it
                <div key={name} id={anchor(name)} className="scroll-mt-16">
                  {sections[name](access)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
