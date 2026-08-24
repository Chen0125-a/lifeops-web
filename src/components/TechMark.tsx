import type { SVGProps } from 'react'

interface TechMarkProps extends SVGProps<SVGSVGElement> {
  slug: string
}

const Atom = () => (
  <>
    <ellipse cx="24" cy="24" rx="19" ry="7" />
    <ellipse cx="24" cy="24" rx="19" ry="7" transform="rotate(60 24 24)" />
    <ellipse cx="24" cy="24" rx="19" ry="7" transform="rotate(120 24 24)" />
    <circle cx="24" cy="24" r="3" fill="currentColor" stroke="none" />
  </>
)

export function TechMark({ slug, ...props }: TechMarkProps) {
  const common = {
    viewBox: '0 0 48 48',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...props,
  }

  if (slug === 'react') return <svg {...common}><Atom /></svg>
  if (slug === 'typescript') {
    return <svg {...common}><rect x="5" y="5" width="38" height="38" rx="5" /><path d="M13 18h20M23 18v18M29 27c1.5-3 8-2.8 8 1 0 4-8 2-8 6 0 3.7 6.8 4.2 9 1" /></svg>
  }
  if (slug === 'mysql') {
    return <svg {...common}><path d="M7 34c5-12 14-18 28-17 3 .2 5-2 6-6 2 8-2 14-9 17-7 3-15 5-25 6Z" /><path d="M17 31c4-7 10-11 18-12" /></svg>
  }
  if (slug === 'docker') {
    return <svg {...common}><path d="M6 24h31c0 11-7 17-18 17C10 41 6 35 6 24Z" /><path d="M39 22c2-4 5-5 8-3-1 4-4 6-9 6M12 18h7v6h-7zm8 0h7v6h-7zm8 0h7v6h-7zm-8-7h7v6h-7zm8 0h7v6h-7" /></svg>
  }
  if (slug === 'kubernetes') {
    return <svg {...common}><path d="m24 4 16 9v18l-16 9-16-9V13l16-9Z" /><circle cx="24" cy="22" r="7" /><path d="M24 10v5m0 14v7M13 17l5 3m12 5 6 3M13 29l6-4m11-6 5-3" /></svg>
  }
  if (slug === 'helm') {
    return <svg {...common}><circle cx="24" cy="24" r="12" /><circle cx="24" cy="24" r="3" fill="currentColor" /><path d="M24 4v8m0 24v8M4 24h8m24 0h8M10 10l6 6m16 16 6 6m0-28-6 6M16 32l-6 6" /></svg>
  }
  if (slug === 'github') {
    return <svg {...common}><path d="M24 5a18 18 0 0 0-6 35v-6c-5 1-6-2-7-4-1-2-2-2-3-3 3-1 4 2 5 3 2 2 4 1 5 1 0-2 1-3 2-4-4 0-8-2-8-8 0-2 1-4 2-5-1-2 0-4 0-5 3 0 5 2 6 2a20 20 0 0 1 11 0c1 0 3-2 6-2 0 1 1 3 0 5 2 1 2 3 2 5 0 6-4 8-8 8 2 2 2 4 2 7v7A18 18 0 0 0 24 5Z" fill="currentColor" stroke="none" /></svg>
  }
  if (slug === 'jenkins') {
    return <svg {...common}><circle cx="24" cy="24" r="19" /><path d="M18 13c1-5 11-5 12 1 1 4-2 6-2 9 0 4 5 4 5 9 0 6-18 7-18 0 0-4 5-5 5-9 0-3-3-5-2-10Z" /><path d="M19 30c3 2 7 2 10 0" /></svg>
  }
  if (slug === 'argo-cd') {
    return <svg {...common}><path d="M7 24h27" /><path d="m27 16 8 8-8 8" /><path d="M10 14c5-7 18-9 27-2M10 34c5 7 18 9 27 2" /></svg>
  }
  return <svg {...common}><circle cx="14" cy="12" r="5" /><circle cx="14" cy="36" r="5" /><circle cx="36" cy="24" r="5" /><path d="M14 17v10c0 5 4 9 9 9h8M14 31c0-5 4-9 9-9h8" /></svg>
}
