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
    expect(daySkyRule).not.toMatch(/transition/i)
    expect(starRule).not.toMatch(/transition/i)
    expect(switchMarkRule).toMatch(/transition\s*:\s*transform 420ms cubic-bezier\(\.2, \.8, \.2, 1\)/i)
    expect(switchMarkRule).toMatch(/will-change\s*:\s*transform/i)
    expect(publicCss).toMatch(/\.public-header\[data-public-surface-theme='night'\] \.theme-switch__mark\s*\{[^}]*transform\s*:\s*rotate\(-180deg\)/s)
    expect(publicCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.public-home,\s*\.public-home \.theme-switch__mark,/s)
  })

  it('keeps public header controls out of the WebKit backdrop compositor during theme changes', () => {
    const sharedHeaderControls = publicCss.match(
      /\.public-home \.theme-switch,\s*\.public-home \.login-trigger,\s*\.public-home \.public-orbit__motion-control\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''
    const motionControl = publicCss.match(
      /\.public-home \.motion-switch\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''

    expect(sharedHeaderControls).not.toMatch(/backdrop-filter/i)
    expect(motionControl).not.toMatch(/backdrop-filter/i)
  })

  it('uses static ring strokes and tiny promoted motion markers instead of full-ring masks', () => {
    const legacyRingPaint = publicCss.match(
      /\.public-home \.public-orbit__ring::before\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''
    const boundary = publicCss.match(
      /\.public-home \.public-orbit__boundary\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''
    const marker = publicCss.match(
      /\.public-home \.public-orbit__track-marker\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''
    const dayTrack = publicCss.match(
      /\.public-hero__stage\[data-public-surface-theme='day'\] \.public-orbit__(?:boundary|track-marker)\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''
    const nightMedallion = publicCss.match(
      /\.public-hero__stage\[data-public-surface-theme='night'\] \.public-object__medallion\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''

    expect(legacyRingPaint).toMatch(/content\s*:\s*none/i)
    expect(legacyRingPaint).not.toMatch(/mask|linear-gradient/i)
    expect(boundary).toMatch(/border\s*:\s*var\(--ring-track-width\) solid/i)
    expect(boundary).toMatch(/opacity\s*:\s*1/i)
    expect(marker).toMatch(/width\s*:\s*6px/i)
    expect(marker).toMatch(/height\s*:\s*2px/i)
    expect(marker).toMatch(/contain\s*:\s*paint/i)
    expect(marker).toMatch(/will-change\s*:\s*transform/i)
    expect(dayTrack).toMatch(/rgba\(149, 120, 168,/i)
    expect(nightMedallion).not.toMatch(/filter\s*:/i)
  })

  it('paints day or night art on one contained sky surface without full-screen compositor layers', () => {
    const root = publicCss.match(
      /\.public-home\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''
    const nightRoot = publicCss.match(
      /\.public-home\[data-public-theme='night'\]\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''
    const sky = publicCss.match(
      /\.public-home \.public-sky\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''
    const skyBefore = publicCss.match(
      /\.public-home \.public-sky::before\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''
    const stars = publicCss.match(
      /\.public-home \.public-sky__stars\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''
    const nightSky = publicCss.match(
      /\.public-sky\[data-public-surface-theme='night'\]\s*\{(?<body>[^}]*)\}/s,
    )?.groups?.body ?? ''

    expect(root).toMatch(/background-color\s*:\s*#020306/i)
    expect(nightRoot).not.toMatch(/background-color|background-image/i)
    expect(sky).toMatch(/contain\s*:\s*paint/i)
    expect(sky).toMatch(/background-color\s*:\s*#f3f8f5/i)
    expect(sky).toMatch(/url\('\/public-day-sky-top\.svg'\).*url\('\/public-day-sky-bottom\.svg'\)/s)
    expect(sky).not.toMatch(/will-change|translateZ|opacity\s*:/i)
    expect(nightSky).toMatch(/background-color\s*:\s*#020306/i)
    expect(nightSky).toMatch(/background-image\s*:\s*url\('\/public-stars\.svg'\)/i)
    expect(nightSky).toMatch(/background-position\s*:\s*center/i)
    expect(nightSky).toMatch(/background-size\s*:\s*cover/i)
    expect(skyBefore).toMatch(/content\s*:\s*none/i)
    expect(stars).not.toMatch(/display\s*:\s*none/i)
    expect(stars).toMatch(/position\s*:\s*absolute/i)
    expect(stars).toMatch(/inset\s*:\s*0/i)
    expect(stars).toMatch(/visibility\s*:\s*hidden/i)
    expect(stars).not.toMatch(/will-change|translateZ|opacity\s*:/i)
    expect(nightRoot).not.toMatch(/--public-/i)
    expect(publicCss).toMatch(/\.public-header\[data-public-surface-theme='night'\]\s*\{/s)
    expect(publicCss).toMatch(/\.public-hero__copy\[data-public-surface-theme='night'\]\s*\{/s)
    expect(publicCss).toMatch(/\.public-hero__stage\[data-public-surface-theme='night'\]\s*\{/s)
    expect(publicCss).not.toMatch(/\.public-home\[data-public-theme='(?:day|night)'\] \.public-(?:sky|header|hero|orbit|object)/s)
  })
})
