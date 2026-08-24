import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { createMemoryStorage, LifeRepository } from '../../domain/lifeRepository'
import { LifeDataProvider } from '../../state/LifeDataContext'
import { KnowledgePage } from './KnowledgePage'

describe('KnowledgePage', () => {
  it('uses a search-first library instead of a constellation', () => {
    const repository = new LifeRepository({ storage: createMemoryStorage(), createId: () => 'id', now: () => '2026-08-09' })
    const review = repository.createReview({ periodStart: '2026-08-01', periodEnd: '2026-08-09', summary: '理解来源关系' })
    repository.createKnowledgeNote({ sourceType: 'review', sourceId: review.id, title: '闭环原则', body: '每个结果都能回到来源', tags: ['闭环'] })
    const { container } = render(<LifeDataProvider repository={repository}><MemoryRouter><KnowledgePage /></MemoryRouter></LifeDataProvider>)
    expect(screen.getByRole('searchbox', { name: '搜索知识' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '闭环原则' })).toBeInTheDocument()
    expect(container.querySelector('.knowledge-constellation')).not.toBeInTheDocument()
  })
})
