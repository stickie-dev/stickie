import { gitConfigValue } from './git.js'
import type { Store } from './store.js'
import type { Actor } from '@stickie/shared'

/**
 * Who the person at this machine is, with no authentication anywhere in sight.
 * A name is enough to make the record say *who* instead of just "a user", and
 * that is worth having now: history cannot be written backwards, so a note
 * recorded today without a name never gets one.
 *
 * It is resolved *per repository*, because that is what git itself does — a
 * repo with its own `user.name` is who a commit there would be attributed to,
 * and someone whose global identity is their employer's may well review a
 * personal repository under a different one. Reading the config inside the repo
 * gives git's own answer, local overriding global, in one call.
 *
 * What this is not: proof. Anyone with the server can call themselves anything.
 * Nothing here should be presented as a verified identity.
 */

export type IdentitySource =
  | 'settings'
  | 'git'
  | 'git-global'
  | 'environment'
  | 'fallback'

export interface ResolvedIdentity {
  name: string
  email: string | null
  /** where the name came from, so the settings page can say so */
  source: IdentitySource
}

const setting_key = 'actor_name'

export async function resolveIdentity(
  store: Store,
  repoPath: string | null,
): Promise<ResolvedIdentity> {
  const chosen = await store.getSetting(setting_key)
  if (chosen !== null && chosen.trim() !== '') {
    return {
      name: chosen.trim(),
      email: await effectiveEmail(repoPath),
      source: 'settings',
    }
  }

  if (repoPath !== null) {
    // inside a repo git reads local over global, which is exactly the identity
    // a commit made there would carry
    const name = await gitConfigValue('user.name', repoPath)
    if (name !== null) {
      return {
        name,
        email: await gitConfigValue('user.email', repoPath),
        source: 'git',
      }
    }
  }

  const global_name = await gitConfigValue('user.name')
  if (global_name !== null) {
    return {
      name: global_name,
      email: await gitConfigValue('user.email'),
      source: 'git-global',
    }
  }

  const user = process.env.USER ?? process.env.USERNAME
  const email = await effectiveEmail(repoPath)
  if (user !== undefined && user !== '') {
    return { name: user, email, source: 'environment' }
  }
  return { name: 'you', email, source: 'fallback' }
}

function effectiveEmail(repoPath: string | null): Promise<string | null> {
  return repoPath === null
    ? gitConfigValue('user.email')
    : gitConfigValue('user.email', repoPath)
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
 * Caches the resolved actor per repository, since resolving one shells out to
 * git. `forget` is called when the name setting changes.
 */
export class Identity {
  private cache = new Map<
    string,
    { actor: Actor; resolved: ResolvedIdentity }
  >()

  constructor(private store: Store) {}

  /** `repoPath` null asks who this machine is with no repository in hand. */
  async human(
    repoPath: string | null,
  ): Promise<{ actor: Actor; resolved: ResolvedIdentity }> {
    const key = repoPath ?? ''
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const resolved = await resolveIdentity(this.store, repoPath)
    const actor = await this.store.getOrCreateActor(
      'human',
      resolved.name,
      resolved.email,
    )
    const entry = { actor, resolved }
    this.cache.set(key, entry)
    return entry
  }

  async agent(claimed: string | undefined): Promise<Actor> {
    return this.store.getOrCreateActor('agent', agentName(claimed))
  }

  forget(): void {
    this.cache.clear()
  }
}
