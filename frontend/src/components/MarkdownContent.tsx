import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type MarkdownContentProps = {
  content: string
  className?: string
}

export function MarkdownContent({
  content,
  className = 'admin-markdown space-y-3 text-sm leading-relaxed text-foreground',
}: MarkdownContentProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
