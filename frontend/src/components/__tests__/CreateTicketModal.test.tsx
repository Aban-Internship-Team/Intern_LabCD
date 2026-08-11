import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CreateTicketModal } from '../CreateTicketModal'
import { ticketsApi } from '../../api/endpoints'
import type { Ticket } from '../../api/types'

vi.mock('../../api/endpoints', () => ({
  ticketsApi: {
    create: vi.fn(),
  },
}))

const mockedCreate = vi.mocked(ticketsApi.create)

const FAKE_TICKET: Ticket = {
  id: 1,
  user_id: 1,
  user_email: 'user@example.com',
  assigned_to: null,
  assignee_email: null,
  title: 'My printer is on fire',
  description: 'Smoke everywhere',
  category: 'technical',
  priority: 'high',
  status: 'open',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  closed_at: null,
  messages: [],
}

describe('CreateTicketModal', () => {
  beforeEach(() => {
    mockedCreate.mockReset()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <CreateTicketModal open={false} onClose={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a validation error when the fields are only whitespace', async () => {
    // Both fields are `required`, so the browser blocks a truly empty
    // submit natively — whitespace passes that check but still fails the
    // component's own trim() validation.
    const user = userEvent.setup()
    render(<CreateTicketModal open onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText(/short summary/i), '   ')
    await user.type(screen.getByPlaceholderText(/what happened/i), '   ')
    await user.click(screen.getByRole('button', { name: 'Create ticket' }))

    expect(
      await screen.findByText(/title and description are required/i),
    ).toBeInTheDocument()
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('submits the form and calls onCreated with the new ticket', async () => {
    mockedCreate.mockResolvedValueOnce(FAKE_TICKET)
    const onCreated = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(<CreateTicketModal open onClose={onClose} onCreated={onCreated} />)

    await user.type(screen.getByPlaceholderText(/short summary/i), 'My printer is on fire')
    await user.type(
      screen.getByPlaceholderText(/what happened/i),
      'Smoke everywhere',
    )
    await user.selectOptions(screen.getByLabelText(/category/i), 'technical')
    await user.selectOptions(screen.getByLabelText(/priority/i), 'high')

    await user.click(screen.getByRole('button', { name: 'Create ticket' }))

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1))
    expect(mockedCreate).toHaveBeenCalledWith({
      title: 'My printer is on fire',
      description: 'Smoke everywhere',
      category: 'technical',
      priority: 'high',
    })
    expect(onCreated).toHaveBeenCalledWith(FAKE_TICKET)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows an error message and keeps the modal open when the API call fails', async () => {
    mockedCreate.mockRejectedValueOnce(new Error('Server exploded'))
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(<CreateTicketModal open onClose={onClose} />)

    await user.type(screen.getByPlaceholderText(/short summary/i), 'Title')
    await user.type(screen.getByPlaceholderText(/what happened/i), 'Description')
    await user.click(screen.getByRole('button', { name: 'Create ticket' }))

    expect(await screen.findByText('Server exploded')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('resets its fields each time it is reopened', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CreateTicketModal open onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText(/short summary/i), 'Draft title')
    rerender(<CreateTicketModal open={false} onClose={vi.fn()} />)
    rerender(<CreateTicketModal open onClose={vi.fn()} />)

    expect(screen.getByPlaceholderText(/short summary/i)).toHaveValue('')
  })
})
