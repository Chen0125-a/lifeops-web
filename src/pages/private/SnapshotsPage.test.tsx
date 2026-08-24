import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createMemoryStorage, LifeRepository } from '../../domain/lifeRepository'
import { LifeDataProvider } from '../../state/LifeDataContext'
import { SnapshotsPage } from './SnapshotsPage'

describe('SnapshotsPage', () => {
  it('requires an explicit public title and excerpt instead of copying private body text', async () => {
    const user = userEvent.setup()
    const repository = new LifeRepository({ storage: createMemoryStorage() })
    const record = repository.createRecord({
      title: '私人记录标题',
      body: '这段完整正文绝对不能被自动带入公开副本。',
    })
    render(
      <LifeDataProvider repository={repository}>
        <MemoryRouter initialEntries={[`/app/snapshots?source=record&id=${record.id}`]}>
          <SnapshotsPage />
        </MemoryRouter>
      </LifeDataProvider>,
    )

    expect(screen.queryByText(record.body)).not.toBeInTheDocument()
    expect(screen.getByLabelText('公开快照标题')).toHaveValue(record.title)
    expect(screen.getByLabelText('公开摘录')).toHaveValue('')
    expect(screen.getByRole('button', { name: '生成快照预览' })).toBeDisabled()

    await user.clear(screen.getByLabelText('公开快照标题'))
    await user.type(screen.getByLabelText('公开快照标题'), '允许公开的标题')
    await user.type(screen.getByLabelText('公开摘录'), '这是经过主动编辑和确认的摘录。')
    await user.click(screen.getByRole('button', { name: '生成快照预览' }))

    expect(repository.getSnapshot().snapshots[0]).toMatchObject({
      title: '允许公开的标题',
      excerpt: '这是经过主动编辑和确认的摘录。',
      visibility: 'private',
    })
    expect(screen.queryByText(record.body)).not.toBeInTheDocument()
  })
})

