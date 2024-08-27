const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const path = require('path')
const { Pinecone } = require('@pinecone-database/pinecone') // Import Pinecone

dotenv.config({ path: path.resolve(__dirname, '../.env') }) // Point to the root .env

const app = express()
const PORT = process.env.PORT || 5001

// Initialize Pinecone client
const pineconeApiKey = process.env.PINECONE_API_KEY

if (!pineconeApiKey) {
  throw new Error('Pinecone API key must be specified in the .env file.')
}

const pc = new Pinecone({
  apiKey: pineconeApiKey,
})

app.use(cors())
app.use(express.json())

// Example route to list indexes
app.get('/api/indexes', async (req, res) => {
  try {
    const { indexes: existingIndexes } = await pc.listIndexes() // Fetch indexes
    res.json({ indexes: existingIndexes })
  } catch (error) {
    console.error('Error fetching indexes:', error)
    res.status(500).json({ error: 'Failed to retrieve indexes' })
  }
})

// Example route to handle queries
app.post('/api/query', (req, res) => {
  const { query, indexName } = req.body
  // Add logic to handle the query based on indexName
  res.json({ result: 'Your response here' })
})

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`)
})
