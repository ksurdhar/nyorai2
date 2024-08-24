#!/usr/bin/env node

import { Command } from 'commander'
import dotenv from 'dotenv'
import fs from 'fs-extra'
import * as path from 'path'
import * as readline from 'readline'
import { Pinecone } from '@pinecone-database/pinecone'
import OpenAI from 'openai'
import { fileURLToPath } from 'url'
import { median, mean } from 'mathjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const pineconeApiKey = process.env.PINECONE_API_KEY
const openaiApiKey = process.env.OPENAI_API_KEY

if (!pineconeApiKey || !openaiApiKey) {
  throw new Error('API keys are missing! Check your .env file.')
}

const pc = new Pinecone({
  apiKey: pineconeApiKey as string,
})

const openai = new OpenAI({
  apiKey: openaiApiKey as string,
})

const program = new Command()

program
  .option('-d, --dir <directory>', 'Directory to index')
  .option('-q, --query', 'Activate query prompt mode')
  .option('--debug', 'Enable debug mode') // Add debug option
  .parse(process.argv)

const options = program.opts()
const directory = options.dir || process.cwd()
const queryMode = options.query || false
const debugMode = options.debug || false

function findProjectRoot(dir: string): string[] {
  let currentDir = dir

  while (currentDir !== path.parse(currentDir).root) {
    const parentDir = path.basename(path.dirname(currentDir))

    if (parentDir.toLowerCase() === 'projects') {
      const immediateDir = path.basename(currentDir)
      return [immediateDir, path.basename(dir)]
    }

    currentDir = path.dirname(currentDir)
  }

  throw new Error('No directory named "projects" found in the path hierarchy.')
}

async function initializePineconeIndex(indexName: string) {
  try {
    const { indexes: existingIndexes } = await pc.listIndexes()
    const indexNames = existingIndexes?.map((index) => index.name)

    if (!indexNames || !indexNames.includes(indexName)) {
      await pc.createIndex({
        name: indexName,
        dimension: 1536,
        spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
      })
    }
  } catch (error) {
    console.error('Error initializing Pinecone index:', error)
    throw error
  }
}

async function readFilesRecursively(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const files = await Promise.all(
      entries.map(async (entry) => {
        const res = path.resolve(dir, entry.name)
        return entry.isDirectory() ? readFilesRecursively(res) : [res]
      })
    )
    return files.flat()
  } catch (error) {
    console.error('Error reading files:', error)
    throw error
  }
}

async function indexFiles(files: string[], indexName: string) {
  const index = pc.index(indexName)

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf8')
      const contentWithFilePath = `File path: ${file}\n\n${content}`

      const embedding = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: contentWithFilePath,
      })

      await index.upsert([
        {
          id: file,
          values: embedding.data[0].embedding,
          metadata: {
            path: file,
            text: contentWithFilePath,
          },
        },
      ])

      console.log(`Indexed file: ${file}`)
    } catch (error) {
      console.error(`Error indexing file ${file}:`, error)
    }
  }
}

async function performRAG(
  query: string,
  indexName: string,
  chatHistory: any[]
) {
  try {
    const queryEmbedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })

    const queryVector = queryEmbedding.data[0].embedding

    const index = pc.index(indexName)
    const searchResults = await index.query({
      vector: queryVector,
      topK: 20,
      includeMetadata: true,
    })

    //Calculate mean and median of the scores
    const scores = searchResults.matches
      .map((match) => match.score)
      .filter((score): score is number => score !== undefined)

    const meanScore = mean(scores)
    const medianScore = median(scores)

    // Determine the contexts to send
    const minContexts = 5 // Minimum number of contexts to send
    const maxContexts = 10 // Maximum number of contexts to send

    // Filter contexts based on their proximity to the mean or median score
    const relevantMatches = searchResults.matches
      .filter(
        (match) =>
          match.score !== undefined &&
          (match.score >= medianScore || match.score >= meanScore)
      )
      .slice(0, maxContexts)

    const relevantContexts = relevantMatches
      .map((match) => match.metadata?.text)
      .filter(Boolean)

    // Ensure at least `minContexts` are selected
    while (
      relevantContexts.length < minContexts &&
      searchResults.matches.length > relevantContexts.length
    ) {
      relevantContexts.push(
        searchResults.matches[relevantContexts.length].metadata?.text
      )
    }

    chatHistory.push({
      role: 'user',
      content: query,
    })

    chatHistory.push({
      role: 'assistant',
      content: `Here are some relevant contexts: ${relevantContexts.join(
        '\n'
      )}\n\nAnswer the following question: ${query}`,
    })

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: chatHistory,
      stream: true,
    })

    let response = ''

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      process.stdout.write(content)
      response += content
    }

    console.log('\n')

    chatHistory.push({
      role: 'assistant',
      content: response.trim(),
    })

    if (debugMode) {
      const filesConsidered = relevantMatches
        .map((match) => match.metadata?.path)
        .filter(Boolean)
      console.log('\nFiles considered when answering the question:')
      filesConsidered.forEach((file) => console.log(file))
    }
  } catch (error) {
    console.error('Error during RAG process:', error)
  }
}

async function promptLoop(indexName: string) {
  const chatHistory = [
    {
      role: 'system',
      content: 'You are a helpful assistant knowledgeable about codebases.',
    },
  ]

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const askQuestion = () => {
    rl.question('Ask a question or type "exit" to quit: ', async (query) => {
      if (query.toLowerCase() === 'exit') {
        rl.close()
        return
      }

      await performRAG(query, indexName, chatHistory)
      askQuestion()
    })
  }

  askQuestion()
}

async function main() {
  try {
    const [parentDir, currentDir] = findProjectRoot(directory)
    const indexName = `${parentDir}-${currentDir}`
    await initializePineconeIndex(indexName)

    if (queryMode) {
      await promptLoop(indexName)
    } else {
      const files = await readFilesRecursively(directory)
      await indexFiles(files, indexName)
      console.log(
        `Successfully indexed ${files.length} files in Pinecone under index '${indexName}'`
      )
    }
  } catch (error) {
    console.error('An error occurred:', error)
  }
}

main().catch(console.error)
