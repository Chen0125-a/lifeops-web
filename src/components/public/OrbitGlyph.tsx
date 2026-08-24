import type { PublicDestinationGlyph } from '../../content/publicDestinations'

const sharedProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.45,
}

export function OrbitGlyph({ glyph }: { glyph: PublicDestinationGlyph }) {
  return (
    <svg aria-hidden="true" className="orbit-glyph" data-orbit-glyph-art={glyph} focusable="false" viewBox="0 0 36 36">
      {glyph === 'sundial' ? (
        <g {...sharedProps}>
          <path d="M5.5 25.2c3.5-5.1 7.7-7.6 12.5-7.6s9 2.5 12.5 7.6" />
          <path d="M18 6.2v11.4l7.2 3.8" />
          <path d="M8.6 15.5 6.1 13.7M27.4 15.5l2.5-1.8M18 10V6.2" />
          <path d="M8.4 25.2h19.2" opacity=".55" />
        </g>
      ) : null}
      {glyph === 'navigation-flag' ? (
        <g {...sharedProps}>
          <path d="M10 29V6.5" />
          <path d="M10 8c4.8-3.2 8.7 2.8 16-.9v11.6c-7.3 3.7-11.2-2.3-16 .9" />
          <path d="M6.8 29h6.4" />
          <circle cx="10" cy="6.5" r="1.2" />
        </g>
      ) : null}
      {glyph === 'open-book' ? (
        <g {...sharedProps}>
          <path d="M4.7 8.5c6-1.2 10.4.4 13.3 3.6v16c-2.9-3.2-7.3-4.8-13.3-3.6Z" />
          <path d="M31.3 8.5c-6-1.2-10.4.4-13.3 3.6v16c2.9-3.2 7.3-4.8 13.3-3.6Z" />
          <path d="M8.3 13.1c2.8-.2 5 .5 6.7 1.8M27.7 13.1c-2.8-.2-5 .5-6.7 1.8" opacity=".55" />
        </g>
      ) : null}
      {glyph === 'viewfinder' ? (
        <g {...sharedProps}>
          <path d="M13 6H6v7M23 6h7v7M13 30H6v-7M23 30h7v-7" />
          <circle cx="18" cy="18" r="5.1" />
          <circle cx="18" cy="18" r="1.2" opacity=".62" />
        </g>
      ) : null}
      {glyph === 'tree-ring' ? (
        <g {...sharedProps}>
          <path d="M18.5 5.4c8 .2 12.5 5.7 11.8 13-.7 8-7.1 12.1-14.8 11.1-7.3-.9-10.6-6.2-9.9-12.3C6.3 10.2 11.8 5.2 18.5 5.4Z" />
          <path d="M18 10c5.1 0 8 3.3 7.6 7.7-.4 5-4.3 7.6-8.9 7.1-4.5-.5-6.7-3.8-6.3-7.6.4-4.4 3.7-7.2 7.6-7.2Z" />
          <path d="M18.1 14.3c2.4 0 3.5 1.6 3.3 3.5-.2 2.2-1.8 3.4-3.8 3.2-2-.2-3-1.7-2.9-3.4.2-2 1.7-3.3 3.4-3.3Z" />
          <path d="m21.4 16.8 7.3-4.7" />
        </g>
      ) : null}
    </svg>
  )
}
