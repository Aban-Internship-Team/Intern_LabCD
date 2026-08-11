import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TicketMessageThread } from '../TicketMessageThread'
import type { TicketMessage } from '../../api/types'

const MESSAGES: TicketMessage[] = [
  {
    id: 1,
    ticket_id: 10,
    sender_id: 1,
    sender_email: 'user@example.com',
    message: 'Hi, any update?',
    created_at: '2026-01-01T10:00:00Z',
  },
  {
    id: 2,
    ticket_id: 10,
    sender_id: 2,
    sender_email: 'agent@example.com',
    message: 'Looking into it now.',
    created_at: '2026-01-01T10:05:00Z',
  },
]

describe('TicketMessageThread', () => {
  it('shows the empty state when there are no messages', () => {
    render(
      <TicketMessageThread
        messages={[]}
        currentUserId={1}
        draft=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
      />,
    )
    expect(screen.getByText('No replies yet.')).toBeInTheDocument()
  })

  it('supports a custom empty state label', () => {
    render(
      <TicketMessageThread
        messages={[]}
        currentUserId={1}
        draft=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        emptyLabel="Nothing here yet."
      />,
    )
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument()
  })

  it('renders every message with its sender', () => {
    render(
      <TicketMessageThread
        messages={MESSAGES}
        currentUserId={1}
        draft=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
      />,
    )
    expect(screen.getByText('Hi, any update?')).toBeInTheDocument()
    expect(screen.getByText('Looking into it now.')).toBeInTheDocument()
    expect(screen.getByText(/agent@example.com/)).toBeInTheDocument()
  })

  it('calls onDraftChange as the user types', async () => {
    const onDraftChange = vi.fn()
    const user = userEvent.setup()

    render(
      <TicketMessageThread
        messages={[]}
        currentUserId={1}
        draft=""
        onDraftChange={onDraftChange}
        onSend={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText('Ticket reply'), 'Hey')
    expect(onDraftChange).toHaveBeenCalledTimes(3)
    expect(onDraftChange).toHaveBeenLastCalledWith('y')
  })

  it('disables the send button while the draft is empty', () => {
    render(
      <TicketMessageThread
        messages={[]}
        currentUserId={1}
        draft="   "
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('calls onSend when the form is submitted with a non-empty draft', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()

    render(
      <TicketMessageThread
        messages={[]}
        currentUserId={1}
        draft="Hello there"
        onDraftChange={vi.fn()}
        onSend={onSend}
      />,
    )

    await user.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('disables the input and shows a closed placeholder when disabled', () => {
    render(
      <TicketMessageThread
        messages={[]}
        currentUserId={1}
        draft=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        disabled
      />,
    )
    const input = screen.getByPlaceholderText('Ticket is closed')
    expect(input).toBeDisabled()
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })

  it('does not call onSend while a send is already in flight', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()

    render(
      <TicketMessageThread
        messages={[]}
        currentUserId={1}
        draft="Hello"
        onDraftChange={vi.fn()}
        onSend={onSend}
        sending
      />,
    )

    // Button is disabled while sending, so a click should not fire onSend.
    await user.click(screen.getByRole('button', { name: '…' }))
    expect(onSend).not.toHaveBeenCalled()
  })
})
