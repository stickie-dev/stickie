import { describe, expect, it } from 'vitest'
import { parseLsof, parseNetstat, parseSs, parseTasklist } from './portHolder.js'

describe('parseLsof', () => {
  it('reads the pid and the whole command name', () => {
    expect(parseLsof('p51234\ncDocker Desktop\nf12\n')).toEqual({
      name: 'Docker Desktop',
      pid: 51234,
    })
  })

  it('is null when nothing listens', () => {
    expect(parseLsof('')).toBeNull()
  })
})

describe('parseSs', () => {
  it('reads the first process of the socket', () => {
    expect(
      parseSs(
        'LISTEN 0 4096 127.0.0.1:4870 0.0.0.0:* users:(("python3",pid=51234,fd=3))\n',
      ),
    ).toEqual({ name: 'python3', pid: 51234 })
  })

  it('is null when ss may not name the process', () => {
    expect(parseSs('LISTEN 0 4096 127.0.0.1:4870 0.0.0.0:*\n')).toBeNull()
  })
})

describe('parseNetstat', () => {
  const table = [
    '',
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:48700          0.0.0.0:0              LISTENING       111',
    '  TCP    127.0.0.1:4870         127.0.0.1:51000        ESTABLISHED     222',
    '  TCP    127.0.0.1:4870         0.0.0.0:0              LISTENING       333',
    '  TCP    [::]:4870              [::]:0                 LISTENING       333',
  ].join('\r\n')

  it('finds the pid listening on exactly that port', () => {
    expect(parseNetstat(table, 4870)).toBe(333)
  })

  it('is null when nothing listens on it', () => {
    expect(parseNetstat(table, 4871)).toBeNull()
  })
})

describe('parseTasklist', () => {
  it('reads the image name', () => {
    expect(
      parseTasklist('"python.exe","333","Console","1","12,345 K"\r\n'),
    ).toBe('python.exe')
  })

  it('is null for tasklist saying no task matched', () => {
    expect(
      parseTasklist('INFO: No tasks are running which match the specified criteria.'),
    ).toBeNull()
  })
})
