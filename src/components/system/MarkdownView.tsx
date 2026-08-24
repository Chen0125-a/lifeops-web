import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

interface MarkdownViewProps {
  className?: string
  source: string
}

const protocol = /^[a-z][a-z\d+.-]*:/i
const safeProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])

function safeUrl(value: string) {
  const normalized = value.trim()
  if (!protocol.test(normalized)) return normalized
  const scheme = normalized.slice(0, normalized.indexOf(':') + 1).toLocaleLowerCase()
  return safeProtocols.has(scheme) ? normalized : ''
}

const components: Components = {
  a: ({ children, href = '', ...props }) => {
    const external = /^https?:/i.test(href)
    return <a {...props} href={href} rel={external ? 'noreferrer noopener' : undefined}>{children}</a>
  },
}

export function MarkdownView({ className, source }: MarkdownViewProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        components={components}
        rehypePlugins={[rehypeSanitize]}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrl}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
