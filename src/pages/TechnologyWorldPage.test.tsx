import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { TechnologyWorldPage } from './TechnologyWorldPage'

describe('TechnologyWorldPage', () => {
  it('renders an honest registry-driven technology world', () => {
    render(
      <MemoryRouter initialEntries={['/worlds/kubernetes']}>
        <Routes><Route path="/worlds/:slug" element={<TechnologyWorldPage />} /></Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Kubernetes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '在 LifeOps 中的角色' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '当前真实状态' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开 Kubernetes 官方文档' })).toHaveAttribute('href', 'https://kubernetes.io/docs/')
  })

  it('does not invent content for an unknown planet', () => {
    render(
      <MemoryRouter initialEntries={['/worlds/unknown']}>
        <Routes><Route path="/worlds/:slug" element={<TechnologyWorldPage />} /></Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '没有找到这颗技术星球' })).toBeInTheDocument()
  })
})
