import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const publicCss = readFileSync(resolve(process.cwd(), 'src/styles/public.css'), 'utf8')

describe('public theme compositor contract', () => {
  it('keeps full-screen theme surfaces atomic and limits animated feedback to the header control', () => {
    const rootRule = publicCss.match(/\.public-home\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? ''
    const daySkyRule = publicCss.match(/\.public-home \.public-sky::before\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? ''
    const starRule = publicCss.match(/\.public-home \.public-sky__stars\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? ''
    const switchMarkRule = publicCss.match(/\.public-home \.theme-switch__mark\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? ''

    expect(rootRule).not.toMatch(/transition\s*:\s*background-color/i)
    expect(daySkyRule).toMatch(/transition\s*:\s*none/i)
    expect(starRule).toMatch(/transition\s*:\s*none/i)
    expect(switchMarkRule).toMatch(/transition\s*:\s*transform 420ms cubic-bezier\(\.2, \.8, \.2, 1\)/i)
    expect(switchMarkRule).toMatch(/will-change\s*:\s*transform/i)
    expect(publicCss).toMatch(/\.public-home\[data-public-theme='night'\] \.theme-switch__mark\s*\{[^}]*transform\s*:\s*rotate\(-180deg\)/s)
    expect(publicCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.public-home,\s*\.public-home \.theme-switch__mark,/s)
  })
})
