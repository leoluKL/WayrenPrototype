import { SessionsContextProvider, useSessionsContext } from './SessionsContextProvider'

export { useSessionsContext }

export function GlobalContext({ children }) {
  return (
    <SessionsContextProvider>
      {children}
    </SessionsContextProvider>
  )
}
