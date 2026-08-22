import { describe, expect, it } from 'vitest'
import { tabLabels } from './tabLabels'

const repo = (id: number) => (id === 1 ? 'orbit-api' : 'orbit-lib')

const label = (tabs: { id: number; repoId: number; path: string }[]) =>
  Object.fromEntries(tabLabels(tabs, repo))

describe('tabLabels', () => {
  it('leaves a unique file name alone', () => {
    expect(
      label([
        { id: 1, repoId: 1, path: 'app/api/batch.py' },
        { id: 2, repoId: 1, path: 'app/api/routes.py' },
      ]),
    ).toEqual({ 1: 'batch.py', 2: 'routes.py' })
  })

  it('names the folder when the collision is one level up', () => {
    expect(
      label([
        { id: 1, repoId: 1, path: 'app/api/batch.py' },
        { id: 2, repoId: 1, path: 'app/handlers/batch.py' },
      ]),
    ).toEqual({ 1: 'api/batch.py', 2: 'handlers/batch.py' })
  })

  it('marks the skipped middle when divergence is further up', () => {
    expect(
      label([
        { id: 1, repoId: 1, path: 'app/api/v1/batch.py' },
        { id: 2, repoId: 1, path: 'app/tests/v1/batch.py' },
      ]),
    ).toEqual({ 1: 'api/…/batch.py', 2: 'tests/…/batch.py' })
  })

  it('handles one path being a prefix of the other', () => {
    expect(
      label([
        { id: 1, repoId: 1, path: 'app/api/batch.py' },
        { id: 2, repoId: 1, path: 'app/api/deep/batch.py' },
      ]),
    ).toEqual({ 1: 'batch.py', 2: 'deep/batch.py' })
  })

  it('falls back to the repository when the paths read alike', () => {
    expect(
      label([
        { id: 1, repoId: 1, path: 'src/jobs/tasks.py' },
        { id: 2, repoId: 2, path: 'src/jobs/tasks.py' },
      ]),
    ).toEqual({
      1: 'orbit-api:tasks.py',
      2: 'orbit-lib:tasks.py',
    })
  })

  it('names the file\u2019s own folder when the diverging one is shared', () => {
    expect(
      label([
        { id: 1, repoId: 1, path: 'app/service/handlers/lookup/models.py' },
        { id: 2, repoId: 1, path: 'app/service/pipelines/models.py' },
        { id: 3, repoId: 1, path: 'app/orbit/api/models.py' },
        { id: 4, repoId: 1, path: 'app/orbit/models/models.py' },
      ]),
    ).toEqual({
      1: 'service/…/lookup/models.py',
      2: 'service/…/pipelines/models.py',
      3: 'orbit/…/api/models.py',
      4: 'orbit/…/models/models.py',
    })
  })

  it('disambiguates three tabs at once', () => {
    expect(
      label([
        { id: 1, repoId: 1, path: 'a/one/store.ts' },
        { id: 2, repoId: 1, path: 'a/two/store.ts' },
        { id: 3, repoId: 1, path: 'a/three/store.ts' },
      ]),
    ).toEqual({ 1: 'one/store.ts', 2: 'two/store.ts', 3: 'three/store.ts' })
  })
})
