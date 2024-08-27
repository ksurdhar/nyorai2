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

    try {
      // Send the initial POST request with fetch
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

      if (!response.ok) {
        throw new Error('Failed to initiate query')
      }

      // Assuming the server responds with a stream ID or some identifier
      const { streamId } = await response.json()

      // Use EventSource to listen to the streaming events
      const eventSource = new EventSource(
        `http://localhost:5001/api/query/stream/${streamId}`
      )

      eventSource.onmessage = (event) => {
        try {
          // Parse the JSON string into an object
          const data = JSON.parse(event.data)

          // Access the specific content you want (e.g., the `content` from `delta`)
          const content = data.choices[0]?.delta?.content || ''

          // Append the content to the response or handle it as needed
          setResponse((prev) => prev + content)
        } catch (error) {
          console.error('Error parsing JSON:', error)
        }
      }

      eventSource.onerror = (error) => {
        console.error('Error fetching data:', error)
        eventSource.close()
      }

      // Close the connection when you don’t need it anymore or once the response is done
      // You may need to implement additional logic to know when to close (based on EOF)
    } catch (error) {
      console.error('Error during query submission:', error)
    }
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
