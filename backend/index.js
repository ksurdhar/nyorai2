import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { Pinecone } from '@pinecone-database/pinecone' // Import Pinecone
import OpenAI from 'openai'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { performRAGStream } from '../dist/query.js'
import { v4 as uuidv4 } from 'uuid' // Import UUID library for generating unique stream IDs
const streams = new Map() // Store ongoing streams

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const app = express()
const PORT = process.env.PORT || 5001

const pineconeApiKey = process.env.PINECONE_API_KEY
const openaiApiKey = process.env.OPENAI_API_KEY

if (!pineconeApiKey || !openaiApiKey) {
  throw new Error('API keys are missing! Check your .env file.')
}

const pc = new Pinecone({
  apiKey: pineconeApiKey,
})

const openai = new OpenAI({
  apiKey: openaiApiKey,
})

app.use(cors())
app.use(express.json())

// Example route to list indexes
app.get('/api/indexes', async (req, res) => {
  try {
    const { indexes: existingIndexes } = await pc.listIndexes()
    res.json({ indexes: existingIndexes })
  } catch (error) {
    console.error('Error fetching indexes:', error)
    res.status(500).json({ error: 'Failed to retrieve indexes' })
  }
})

// Example route to handle queries

app.post('/api/query', (req, res) => {
  const { query, indexName } = req.body
  const streamId = uuidv4() // Generate a unique stream ID

  const chatHistory = [
    {
      role: 'system',
      content: 'You are a helpful assistant knowledgeable about codebases.',
    },
  ]
  const previousResults = new Set()

  // Store the stream state by streamId
  streams.set(streamId, {
    query,
    indexName,
    chatHistory,
    previousResults,
  })

  // Respond with the stream ID
  res.json({ streamId })
})

app.get('/api/query/stream/:streamId', async (req, res) => {
  const { streamId } = req.params
  const streamState = streams.get(streamId)

  if (!streamState) {
    return res.status(404).json({ error: 'Stream not found' })
  }

  const { query, indexName, chatHistory, previousResults } = streamState

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const stream = await performRAGStream(
      query,
      indexName,
      chatHistory,
      previousResults,
      {
        indexer: pc,
        embedder: openai,
      }
    )

    for await (const chunk of stream) {
      try {
        // Ensure the chunk is a string or convert it to a JSON string
        const chunkData =
          typeof chunk === 'string' ? chunk : JSON.stringify(chunk)
        res.write(`data: ${chunkData}\n\n`)
      } catch (error) {
        console.error('Error writing chunk:', error)
        break // Stop processing further if writing fails
      }
    }

    res.write('data: [DONE]\n\n') // Optional: Mark the end of the stream
    res.end()
    streams.delete(streamId) // Clean up the stream state
  } catch (error) {
    console.error('Error streaming data:', error)

    // Ensure you do not send another response after streaming has started
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream data' })
    }

    streams.delete(streamId) // Clean up on error
  }
})

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`)
})
