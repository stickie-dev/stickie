import { Loading, Skeleton, SkeletonRows } from './Skeleton'
import { card } from '../ui'

/**
 * The overview before anything is known about the workspace — not even whether
 * it has repositories in it. Same shape as the page it precedes, so nothing
 * moves when the answer arrives.
 */
export function OverviewSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-edge px-3 py-2 text-xs">
        <img src="/stickie.svg" alt="" className="h-4.5 w-4.5" />
        <span className="font-bold tracking-wide text-ink">stickie</span>
        <span className="text-faint">overview</span>
      </header>
      <div className="min-h-0 grow overflow-y-auto p-6">
        <Loading what="the workspace" className="space-y-2">
          <Skeleton w="w-80" h="h-4" />
          <Skeleton w="w-56" h="h-3" />
        </Loading>
        <section className="mt-6">
          <Skeleton w="w-20" h="h-3.5" className="mb-2" />
          <div className={`overflow-hidden ${card}`}>
            <table className="w-full border-collapse text-xs">
              <tbody>
                <SkeletonRows
                  rows={3}
                  columns={['w-16', 'w-24', 'w-48', 'w-6', 'w-6', 'w-40']}
                />
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
