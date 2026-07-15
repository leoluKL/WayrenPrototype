import { GlobalContext } from './context/GlobalContext'
import Dashboard from './Dashboard'
import './App.css'

export default function App() {
  return (
    <GlobalContext>
      <Dashboard />
    </GlobalContext>
  )
}
