import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import './App.css'
import { CodeBlock } from './codeHighlighter'

function App() {
  const [indexes, setIndexes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null)
  const [query, setQuery] = useState<string>('')
  const [conversation, setConversation] = useState<
    { query: string; response: string }[]
  >([])
  const [chatHistory, setChatHistory] = useState<
    { role: string; content: string }[]
  >([])
  const [previousResults, setPreviousResults] = useState<string[]>([])

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

    const newChatEntry = { query, response: '' }
    setConversation((prev) => [...prev, newChatEntry])

    try {
      const response = await fetch('http://localhost:5001/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          indexName: selectedIndex,
          chatHistory,
          previousResults,
        }),
      })

      setQuery('')

      if (!response.ok) {
        throw new Error('Failed to initiate query')
      }

      const { streamId } = await response.json()

      const eventSource = new EventSource(
        `http://localhost:5001/api/query/stream/${streamId}`
      )

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.previousResults) {
            console.log('previous results', data.previousResults)

            setPreviousResults(data.previousResults)
          } else if (data.chatHistory) {
            console.log('chatHistory', data.chatHistory)
            setChatHistory(data.chatHistory)
          } else {
            const content = data.choices?.[0]?.delta?.content || ''

            setConversation((prev) => {
              const currentEntry = prev[prev.length - 1]
              const updatedEntry = {
                ...currentEntry,
                response: currentEntry.response + content,
              }
              return [...prev.slice(0, -1), updatedEntry]
            })
          }
        } catch (error) {
          console.error('Error parsing JSON:', error)
        }
      }

      eventSource.onerror = (error) => {
        console.error('Error fetching data:', error)
        eventSource.close()
        // think about deleting stream
      }
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

          <div>
            <h2>Chat History:</h2>
            {conversation.map(({ query, response }, index) => (
              <div key={index}>
                <p>
                  <strong>You:</strong> {query}
                </p>
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
            ))}
          </div>
        </div>
      )}

      <p className="read-the-docs">I do not seek, I find. </p>
    </>
  )
}

export default App
