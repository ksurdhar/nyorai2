import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { Pinecone } from '@pinecone-database/pinecone' // Import Pinecone
import OpenAI from 'openai'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { performRAG } from '../dist/query.js'

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
app.post('/api/query', async (req, res) => {
  const { query, indexName } = req.body
  try {
    // Call the performRAG function to handle the question
    const chatHistory = [
      {
        role: 'system',
        content: 'You are a helpful assistant knowledgeable about codebases.',
      },
    ]
    const previousResults = new Set()

    const response = await performRAG(
      query,
      indexName,
      chatHistory,
      previousResults,
      {
        indexer: pc,
        embedder: openai,
        debugMode: false, // Set to true if you want debug information
      }
    )

    res.json({ result: response })
  } catch (error) {
    console.error('Error processing query:', error)
    res.status(500).json({ error: 'Failed to process the query' })
  }
})

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`)
})
