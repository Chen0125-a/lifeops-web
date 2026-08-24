import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from './httpClient'
import { mediaApi, withMediaPreview } from './mediaApi'

vi.mock('./httpClient', () => ({ http: { request: vi.fn() } }))
const request = vi.mocked(http.request)

describe('mediaApi', () => {
  beforeEach(() => request.mockReset())

  it('reports queued, uploading and stored around a cancellable multipart upload', async () => {
    const asset = { id: 'media-1' }
    request.mockResolvedValueOnce(asset)
    const file = new File([new Uint8Array([0x89, 0x50])], 'evidence.png', { type: 'image/png' })
    const signal = new AbortController().signal
    const states: string[] = []
    await expect(mediaApi.upload(file, {
      idempotencyKey: 'media-create-1', csrf: 'csrf-1', signal, onStatus: (state) => states.push(state),
    })).resolves.toBe(asset)
    expect(states).toEqual(['queued', 'uploading', 'stored'])
    const options = request.mock.calls[0]?.[1]
    expect(request.mock.calls[0]?.[0]).toBe('/media')
    expect(options).toMatchObject({ method: 'POST', csrf: 'csrf-1', idempotencyKey: 'media-create-1', signal })
    expect(options?.body).toBeInstanceOf(FormData)
    expect((options?.body as FormData).get('file')).toBe(file)
  })

  it('reports failed and preserves the transport error', async () => {
    const error = new Error('offline')
    request.mockRejectedValueOnce(error)
    const states: string[] = []
    await expect(mediaApi.upload(new File(['x'], 'x.png', { type: 'image/png' }), {
      idempotencyKey: 'media-create-2', onStatus: (state) => states.push(state),
    })).rejects.toBe(error)
    expect(states).toEqual(['queued', 'uploading', 'failed'])
  })

  it('always revokes object URLs after synchronous, asynchronous or failed previews', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview-1')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const file = new File(['preview'], 'preview.png', { type: 'image/png' })
    await expect(withMediaPreview(file, async (url) => `${url}:done`)).resolves.toBe('blob:preview-1:done')
    await expect(withMediaPreview(file, () => { throw new Error('preview failed') })).rejects.toThrow('preview failed')
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, 'blob:preview-1')
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, 'blob:preview-1')
  })

  it('builds encoded private and public read URLs without exposing storage keys', () => {
    expect(mediaApi.privateUrl('media/with space')).toBe('/api/v1/media/media%2Fwith%20space')
    expect(mediaApi.publicUrl('media/with space')).toBe('/api/v1/public/media/media%2Fwith%20space')
  })
})
