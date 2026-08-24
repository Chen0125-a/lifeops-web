import type { PublicDraft, PublicRevision, PublicRevisionDiff } from '../../domain/publishing'

function value(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function RevisionHistory({ diff, draft, onCompare, revisions }: {
  diff?: PublicRevisionDiff
  draft: PublicDraft
  onCompare: (from: number, to: number) => Promise<void>
  revisions: PublicRevision[]
}) {
  const newest = revisions[0]
  const previous = revisions[1]
  return (
    <section aria-label="公开 revision 历史" className="publishing-revisions" role="region">
      <header><p>Immutable history</p><h2>公开 revision</h2></header>
      <ol>{revisions.map((revision) => <li key={revision.id}><strong>Revision {revision.revision}</strong><span>{revision.title}</span><time dateTime={revision.publishedAt}>{revision.publishedAt.slice(0, 10)}</time></li>)}</ol>
      {newest && previous ? <button type="button" onClick={() => void onCompare(previous.revision, newest.revision).catch(() => {})}>比较 Revision {previous.revision} → {newest.revision}</button> : null}
      {diff ? <div className="publishing-revisions__diff" aria-label={`Revision ${diff.from} 到 ${diff.to} 的差异`}>{diff.changed.map((change) => <article key={change.field}><strong>{change.field}</strong><del>{value(change.before)}</del><ins>{value(change.after)}</ins></article>)}</div> : null}
      {!revisions.length ? <p>“{draft.title}”还没有公开 revision。</p> : null}
    </section>
  )
}
