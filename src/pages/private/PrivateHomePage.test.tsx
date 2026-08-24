import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createMemoryStorage, LifeRepository } from '../../domain/lifeRepository'
import { LifeDataProvider } from '../../state/LifeDataContext'
import { PrivateHomePage } from './PrivateHomePage'

describe('PrivateHomePage', () => {
  it('renders a task-first day canvas and creates the next important plan', async () => {
    const user = userEvent.setup()
    const repository = new LifeRepository({ storage: createMemoryStorage() })
    const { container } = render(<LifeDataProvider repository={repository}><MemoryRouter><PrivateHomePage /></MemoryRouter></LifeDataProvider>)
    expect(container.querySelector('[data-day-canvas]')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '今天' })).toBeInTheDocument()
    expect(screen.getByText('06:00')).toBeInTheDocument()
    expect(screen.getByText('22:00')).toBeInTheDocument()
    expect(container.querySelectorAll('[data-dashboard-card]')).toHaveLength(0)
    await user.type(screen.getByLabelText('今天要推进什么'), '完成日光工作台验收')
    await user.click(screen.getByRole('button', { name: '加入今天' }))
    expect(repository.getSnapshot().plans[0].title).toBe('完成日光工作台验收')
    expect(screen.getAllByText('完成日光工作台验收').length).toBeGreaterThan(0)
  })
})
