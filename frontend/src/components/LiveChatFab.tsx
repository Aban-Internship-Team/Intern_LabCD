import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { LiveChatWidget } from './LiveChatWidget'

interface LiveChatFabProps {
  className?: string
}

export function LiveChatFab({ className }: LiveChatFabProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={
          className ??
          'flex size-11 items-center justify-center rounded-full border border-border bg-primary text-primary-foreground shadow-lg transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:size-12'
        }
        aria-label={open ? 'Close live chat' : 'Open live chat'}
        title="Live chat"
        onClick={() => setOpen((prev) => !prev)}
      >
        <MessageCircle className="size-5" aria-hidden />
      </button>
      {open && <LiveChatWidget onClose={() => setOpen(false)} />}
    </>
  )
}
