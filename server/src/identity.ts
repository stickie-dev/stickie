import { gitConfigValue } from './git.js'
import type { Store } from './store.js'
import type { Actor } from '@stickie/shared'

/**
 * Who the person at this machine is, with no authentication anywhere in sight.
 * A name is enough to make the record say *who* instead of just "a user", and
 * that is worth having now: history cannot be written backwards, so a note
 * recorded today without a name never gets one.
 *
 * What this is not: proof. Anyone with the server can call themselves anything.
 * Nothing here should be presented as a verified identity.
 */

export interface ResolvedIdentity {
  name: string
  email: string | null
  /** where the name came from, so the settings page can say so */
  source: 'settings' | 'git-global' | 'git-repo' | 'environment' | 'fallback'
}

const setting_key = 'actor_name'

export async function resolveIdentity(
  store: Store,
  repoPaths: string[],
): Promise<ResolvedIdentity> {
  const chosen = await store.getSetting(setting_key)
  const email = await gitConfigValue('user.email')
  if (chosen !== null && chosen.trim() !== '') {
    return { name: chosen.trim(), email, source: 'settings' }
  }

  const global_name = await gitConfigValue('user.name')
  if (global_name !== null) {
    return { name: global_name, email, source: 'git-global' }
  }

  // a machine with no global identity may still have one per repository
  for (const repo of repoPaths) {
    const name = await gitConfigValue('user.name', repo)
    if (name !== null) {
      return {
        name,
        email: email ?? (await gitConfigValue('user.email', repo)),
        source: 'git-repo',
      }
    }
  }

  const user = process.env.USER ?? process.env.USERNAME
  if (user !== undefined && user !== '') {
    return { name: user, email, source: 'environment' }
  }
  return { name: 'you', email, source: 'fallback' }
}

/**
 * The name an agent posts under. Agents identify themselves in the request, so
 * this only has to keep the value sane and give the ones that say nothing a
 * single shared actor rather than an accidental one per request.
 */
export function agentName(claimed: string | undefined): string {
  const trimmed = (claimed ?? '').trim()
  if (trimmed === '') return 'agent'
  return trimmed.slice(0, 64)
}

/**
 * Caches the resolved human actor for the process, since resolving it shells
 * out to git. `forget` is called when the setting changes.
 */
export class Identity {
  private cached: { actor: Actor; resolved: ResolvedIdentity } | null = null

  constructor(
    private store: Store,
    private repoPaths: () => Promise<string[]>,
  ) {}

  async current(): Promise<{ actor: Actor; resolved: ResolvedIdentity }> {
    if (this.cached !== null) return this.cached
    const resolved = await resolveIdentity(this.store, await this.repoPaths())
    const actor = await this.store.getOrCreateActor(
      'human',
      resolved.name,
      resolved.email,
    )
    this.cached = { actor, resolved }
    return this.cached
  }

  async agent(claimed: string | undefined): Promise<Actor> {
    return this.store.getOrCreateActor('agent', agentName(claimed))
  }

  forget(): void {
    this.cached = null
  }
}
