import iconMap from 'material-icon-theme/dist/material-icons.json'

// vite emits every matched svg as an asset; only the ones actually
// rendered get fetched
const icon_urls = import.meta.glob<string>(
  '../node_modules/material-icon-theme/icons/*.svg',
  { eager: true, import: 'default', query: '?url' },
)

function urlFor(icon: string | undefined): string | null {
  if (icon === undefined) return null
  return (
    icon_urls[`../node_modules/material-icon-theme/icons/${icon}.svg`] ?? null
  )
}

interface IconMap {
  fileExtensions: Record<string, string>
  fileNames: Record<string, string>
  folderNames: Record<string, string>
  folderNamesExpanded: Record<string, string>
  file: string
  folder: string
  folderExpanded: string
}

const map = iconMap as unknown as IconMap

export function fileIconUrl(name: string): string | null {
  const lower = name.toLowerCase()
  const by_name = urlFor(map.fileNames[lower])
  if (by_name !== null) return by_name
  // longest matching multi-part extension wins: foo.test.ts before ts
  const parts = lower.split('.')
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.')
    const url = urlFor(map.fileExtensions[ext])
    if (url !== null) return url
  }
  return urlFor(map.file)
}

export function folderIconUrl(name: string, open: boolean): string | null {
  const lower = name.split('/').at(-1) ?? ''
  const specific = open
    ? map.folderNamesExpanded[lower]
    : map.folderNames[lower]
  return (
    urlFor(specific) ?? urlFor(open ? map.folderExpanded : map.folder)
  )
}
