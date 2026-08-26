import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PublicHomePage } from '../../pages/PublicHomePage'

describe('DaylightAperture', () => {
  it('is one quiet non-interactive opening with no status, metric, date or technology copy', () => {
    render(
      <MemoryRouter>
        <PublicHomePage />
      </MemoryRouter>,
    )

    const aperture = screen.getByTestId('daylight-aperture')
    expect(aperture).toHaveAttribute('aria-hidden', 'true')
    expect(aperture).toBeEmptyDOMElement()
    expect(aperture.querySelector('a, button, input, [role]')).not.toBeInTheDocument()
    expect(aperture).not.toHaveTextContent(/PRIVATE SYSTEM|状态|指标|日期|KUBERNETES|DOCKER|MYSQL|GITOPS/i)
  })

  it('uses one cached star field with three deterministic layers around the aperture', () => {
    const { container } = render(
      <MemoryRouter>
        <PublicHomePage />
      </MemoryRouter>,
    )

    const fields = container.querySelectorAll('[data-star-field]')
    expect(fields).toHaveLength(1)
    expect(fields[0]).toHaveAttribute('data-star-layers', 'far middle near')
    expect(fields[0]).toHaveAttribute('src', '/public-stars.svg')
  })
})
