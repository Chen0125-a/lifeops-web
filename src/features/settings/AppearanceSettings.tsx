import type { SettingsDocument } from '../../domain/settings'

export function AppearanceSettings({ value, saveState, onChange }: {
  value: SettingsDocument['appearance']
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  onChange: (next: SettingsDocument['appearance']) => void
}) {
  const status = saveState === 'saving' ? '正在保存…' : saveState === 'saved' ? '已保存' : saveState === 'error' ? '保存失败，请重试' : '服务器设置'
  return <section className="settings-section" aria-labelledby="settings-appearance-title">
    <header><p>Appearance</p><h2 id="settings-appearance-title">外观与动效</h2><span>界面偏好跟随账户保存；系统减少动效仍具有最高优先级。</span></header>
    <div className="settings-field-row">
      <label htmlFor="settings-theme"><strong>界面主题</strong><span>系统、明亮或暗色；不会改变公开站点内容。</span></label>
      <div><select id="settings-theme" aria-label="界面主题" value={value.theme} onChange={(event) => onChange({ ...value, theme: event.target.value as SettingsDocument['appearance']['theme'] })}><option value="system">跟随系统</option><option value="light">明亮</option><option value="dark">暗色</option></select><small role="status">{status}</small></div>
    </div>
    <div className="settings-field-row">
      <label htmlFor="settings-motion"><strong>动效强度</strong><span>减少动效会保留方向和反馈，不保留装饰性移动。</span></label>
      <select id="settings-motion" aria-label="动效强度" value={value.motion} onChange={(event) => onChange({ ...value, motion: event.target.value as SettingsDocument['appearance']['motion'] })}><option value="system">跟随系统</option><option value="reduce">减少</option><option value="full">完整</option></select>
    </div>
  </section>
}
