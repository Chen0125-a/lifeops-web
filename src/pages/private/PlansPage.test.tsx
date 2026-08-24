import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createMemoryStorage, LifeRepository } from '../../domain/lifeRepository'
import { LifeDataProvider } from '../../state/LifeDataContext'
import { PlansPage } from './PlansPage'

describe('PlansPage', () => {
  it('creates and completes plans in a dedicated planning surface', async () => {
    const user = userEvent.setup()
    const repository = new LifeRepository({ storage: createMemoryStorage() })
    render(<LifeDataProvider repository={repository}><MemoryRouter><PlansPage /></MemoryRouter></LifeDataProvider>)
    await user.type(screen.getByLabelText('计划标题'), '整理本周复盘材料')
    await user.click(screen.getByRole('button', { name: '保存计划' }))
    await user.click(screen.getByRole('button', { name: '完成 整理本周复盘材料' }))
    expect(repository.getSnapshot().plans[0].status).toBe('done')
  })
})
