import { useEffect, useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

function App() {
  const [indexes, setIndexes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch the indexes when the component mounts
  useEffect(() => {
    const fetchIndexes = async () => {
      try {
        const response = await fetch('http://localhost:5001/api/indexes') // Adjust the URL if needed
        if (!response.ok) {
          throw new Error('Network response was not ok')
        }
        const data = await response.json()
        const names = data.indexes.map((index: { name: string }) => index.name)
        console.log(data)
        setIndexes(names)
      } catch (error) {
        console.error('Error fetching indexes:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchIndexes()
  }, [])

  return (
    <>
      <div>
        <a href="https://vitejs.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>

      {loading ? (
        <p>Loading indexes...</p>
      ) : (
        <div className="dropdown">
          <label htmlFor="index-select">Select an Index:</label>
          <select id="index-select">
            {indexes.map((index) => (
              <option key={index} value={index}>
                {index}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
