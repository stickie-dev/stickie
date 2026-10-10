import type { Page } from '../routes'
import { useReview } from '../store'
import { AddRepo } from './AddRepo'
import { OverviewPage } from './OverviewPage'
import { OverviewSkeleton } from './OverviewSkeleton'
import { SettingsPage } from './settings/SettingsPage'

/**
 * What a tab that is not a review shows: Home or Settings.
 *
 * Drawn in the workspace's main area, over the review rather than in place of
 * it, so the review keeps its editors and its scroll while one of these is in
 * front — and the tree, the tabs and the footer stay exactly where they are.
 * They used to be pages of their own, drawn over the whole window, which is
 * why going home and coming back felt like leaving one application for
 * another.
 */
export function PageArea({ page }: { page: Page }) {
  const repos = useReview((s) => s.repos)
  const reposLoaded = useReview((s) => s.reposLoaded)

  if (page.kind === 'settings') return <SettingsPage section={page.section} />

  // home is the overview, and the way in to a workspace with no repos yet.
  // "No repositories" is an answer, so it waits to be sure of it rather than
  // offering to add the first one every time a cold load takes a moment
  if (page.kind === 'home') {
    if (!reposLoaded) return <OverviewSkeleton />
    return repos.length === 0 ? <AddRepo /> : <OverviewPage />
  }

  return null
}
