import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import './App.css'
import { CodeBlock } from './codeHighlighter'

function App() {
  const [indexes, setIndexes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null)
  const [query, setQuery] = useState<string>('')
  const [response, setResponse] = useState<string>('')

  // Fetch the indexes when the component mounts
  useEffect(() => {
    const fetchIndexes = async () => {
      try {
        const response = await fetch('http://localhost:5001/api/indexes')
        if (!response.ok) {
          throw new Error('Network response was not ok')
        }
        const data = await response.json()
        const names = data.indexes.map((index: { name: string }) => index.name)
        setIndexes(names)
      } catch (error) {
        console.error('Error fetching indexes:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchIndexes()
  }, [])

  const handleQuerySubmit = async () => {
    if (!query || !selectedIndex) return

    const response = await fetch('http://localhost:5001/api/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        indexName: selectedIndex,
      }),
    })

    const data = await response.json()
    setResponse(data.result || 'No response received')
  }

  return (
    <>
      <h1>Nyorai2</h1>

      {loading ? (
        <p>Loading indexes...</p>
      ) : (
        <div>
          <div className="dropdown">
            <label htmlFor="index-select">Select an Index:</label>
            <select
              id="index-select"
              onChange={(e) => setSelectedIndex(e.target.value)}
            >
              {indexes.map((index) => (
                <option key={index} value={index}>
                  {index}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="query-input">Ask a question:</label>
            <input
              id="query-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button onClick={handleQuerySubmit}>Submit</button>
          </div>

          {response && (
            <div>
              <h2>Response:</h2>
              <ReactMarkdown
                components={{
                  code({ className, children, style }) {
                    const match = /language-(\w+)/.exec(className || '')

                    return match ? (
                      <CodeBlock
                        language={match[1]}
                        value={String(children).replace(/\n$/, '')}
                      />
                    ) : (
                      <code className={className} style={style}>
                        {children}
                      </code>
                    )
                  },
                }}
              >
                {response}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}

      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
