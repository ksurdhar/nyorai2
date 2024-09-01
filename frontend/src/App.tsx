import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import './App.css'
import { CodeBlock } from './codeHighlighter'
import { v4 as uuidv4 } from 'uuid'

function App() {
  const [indexes, setIndexes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null)
  const [query, setQuery] = useState<string>('')
  const [conversation, setConversation] = useState<
    { query: string; response: string }[]
  >([])
  const [mode, setMode] = useState<'query' | 'fileSearch'>('query')
  const [searchResults, setSearchResults] = useState<
    { filename: string; score: number }[]
  >([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [previousResults, setPreviousResults] = useState<string[]>([])
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const existingUserId = sessionStorage.getItem('userId')

    if (!existingUserId) {
      const newUserId = uuidv4()
      setUserId(newUserId)
      sessionStorage.setItem('userId', newUserId)
    } else {
      setUserId(existingUserId)
    }
  }, [])

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

  const handleModeToggle = () => {
    setMode((prev) => (prev === 'query' ? 'fileSearch' : 'query'))
  }

  const handleQuerySubmit = async () => {
    if (!query || !selectedIndex) return

    if (mode === 'fileSearch') {
      const response = await fetch('http://localhost:5001/api/file-search', {
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
        console.error('Failed to fetch file search results')
        return
      }

      const data = await response.json()

      const newResults = data.filter(
        (newResult: { filename: string }) =>
          !searchResults.some(
            (existingResult) => existingResult.filename === newResult.filename
          )
      )

      setSearchResults([...searchResults, ...newResults]) // combine with previous results
      return
    }

    const newChatEntry = { query, response: '' }
    setConversation((prev) => [...prev, newChatEntry])

    const selectedFileIds = searchResults
      .filter(({ filename }) => selectedFiles.has(filename))
      .map(({ filename }) => filename)
    console.log('selectedFileIds:', selectedFileIds)

    try {
      const response = await fetch('http://localhost:5001/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          indexName: selectedIndex,
          userId,
          previousResults,
          selectedFiles: selectedFileIds,
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
            setPreviousResults(data.previousResults)
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

  console.log('previousResults:', previousResults)

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

          <div className="chat-container">
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

      <div className="input-container">
        <textarea
          id="query-input"
          rows={1}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ resize: 'none' }}
          onInput={(e) => {
            e.currentTarget.style.height = 'auto'
            e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`
          }}
        />
        <button onClick={handleQuerySubmit}>Submit</button>
        <button onClick={handleModeToggle}>
          Toggle to {mode === 'query' ? 'File Search' : 'Query'}
        </button>
        {mode === 'fileSearch' && searchResults.length > 0 && (
          <div className="search-results">
            <h2>Search Results:</h2>
            <ul>
              {searchResults.map(({ filename, score }) => (
                <li key={filename}>
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(filename)}
                    onChange={() => {
                      const newSelectedFiles = new Set(selectedFiles)
                      if (newSelectedFiles.has(filename)) {
                        newSelectedFiles.delete(filename)
                      } else {
                        newSelectedFiles.add(filename)
                      }
                      setSelectedFiles(newSelectedFiles)
                    }}
                  />
                  {filename} - Score: {score}
                  <button
                    onClick={() => {
                      const newSelectedFiles = new Set(selectedFiles)
                      newSelectedFiles.delete(filename)
                      setSelectedFiles(newSelectedFiles)
                      const newSearchResults = searchResults.filter(
                        (result) => result.filename !== filename
                      )
                      setSearchResults(newSearchResults)
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="read-the-docs">I do not seek, I find. </p>
    </>
  )
}

export default App
