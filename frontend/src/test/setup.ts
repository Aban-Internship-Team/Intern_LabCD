import '@testing-library/jest-dom/vitest'

// jsdom does not implement scrollIntoView; components that auto-scroll
// (e.g. TicketMessageThread) call it on every message-list update.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
