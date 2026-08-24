import { useEffect, useRef, useState } from 'react'
import { mediaApi } from '../../api/mediaApi'
import type { MediaAsset, UploadStatus } from '../../domain/records'

interface UploadItem {
  asset?: MediaAsset
  file: File
  id: string
  previewUrl: string
  status: UploadStatus
}

interface MediaUploaderProps {
  coverMediaId: string | null
  csrfToken?: string
  disabled?: boolean
  onCoverChange: (id: string | null) => void | Promise<void>
  onRemove: (asset: MediaAsset) => void | Promise<void>
  onUploaded: (asset: MediaAsset) => void | Promise<void>
}

const statusText: Record<UploadStatus, string> = {
  failed: '上传失败',
  queued: '等待上传',
  stored: '上传完成',
  uploading: '正在上传',
}

export function MediaUploader({ coverMediaId, csrfToken, disabled, onCoverChange, onRemove, onUploaded }: MediaUploaderProps) {
  const [items, setItems] = useState<UploadItem[]>([])
  const itemsRef = useRef(items)
  const cancelled = useRef(new Set<string>())
  itemsRef.current = items

  useEffect(() => () => {
    for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl)
  }, [])

  const patch = (id: string, update: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...update } : item))
  }

  const upload = async (item: UploadItem) => {
    try {
      const asset = await mediaApi.upload(item.file, {
        csrf: csrfToken,
        idempotencyKey: `media:${globalThis.crypto.randomUUID()}`,
        onStatus: (status) => patch(item.id, { status }),
      })
      if (cancelled.current.has(item.id)) return
      await onUploaded(asset)
      patch(item.id, { asset, status: 'stored' })
    } catch {
      patch(item.id, { status: 'failed' })
    }
  }

  const choose = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      const item: UploadItem = {
        file,
        id: globalThis.crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
        status: 'queued',
      }
      setItems((current) => [...current, item])
      void upload(item)
    }
  }

  const remove = (item: UploadItem) => {
    cancelled.current.add(item.id)
    URL.revokeObjectURL(item.previewUrl)
    setItems((current) => current.filter((candidate) => candidate.id !== item.id))
    if (item.asset) {
      void onRemove(item.asset)
    }
  }

  return (
    <section className="media-uploader" aria-label="记录图片">
      <label className="media-uploader__pick">
        <span>上传图片</span>
        <span className="media-uploader__pick-action" aria-hidden="true">选择图片</span>
        <input className="media-uploader__file" type="file" aria-label="上传图片" accept="image/jpeg,image/png,image/webp,image/gif" multiple disabled={disabled} onChange={(event) => {
          choose(event.currentTarget.files)
          event.currentTarget.value = ''
        }} />
      </label>
      {items.length ? <ul>{items.map((item) => (
        <li key={item.id}>
          <img src={item.previewUrl} alt={`${item.file.name} 预览`} />
          <div><strong>{item.file.name}</strong><span aria-live="polite">{statusText[item.status]}</span></div>
          <div className="media-uploader__actions">
            {item.status === 'failed' ? <button type="button" onClick={() => void upload(item)}>重试上传 {item.file.name}</button> : null}
            {item.asset ? <button type="button" aria-pressed={coverMediaId === item.asset.id} onClick={() => void onCoverChange(item.asset!.id)}>
              {coverMediaId === item.asset.id ? `当前封面 ${item.file.name}` : `设为封面 ${item.file.name}`}
            </button> : null}
            <button type="button" onClick={() => remove(item)}>移除 {item.file.name}</button>
          </div>
        </li>
      ))}</ul> : null}
    </section>
  )
}
