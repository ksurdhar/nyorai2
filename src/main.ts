#!/usr/bin/env node

import { Command } from 'commander'
import dotenv from 'dotenv'
import * as path from 'path'
import * as readline from 'readline'
import { Pinecone } from '@pinecone-database/pinecone'
import OpenAI from 'openai'
import { fileURLToPath } from 'url'
import {
  initializePineconeIndex,
  readFilesRecursively,
  indexFiles,
} from './indexer.js'
import { performRAG } from './query.js'

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
  .option('--debug', 'Enable debug mode')
  .option('--dryrun', 'Enable dryrun mode')
  .parse(process.argv)

const options = program.opts()
const directory = options.dir || process.cwd()
const queryMode = options.query || false
const debugMode = options.debug || false
const dryrunMode = options.dryrun || false

function findProjectRoot(dir: string): string {
  let currentDir = dir

  while (currentDir !== path.parse(currentDir).root) {
    const parentDir = path.basename(path.dirname(currentDir))

    if (parentDir.toLowerCase() === 'projects') {
      return path.basename(currentDir) // Return only the project root (e.g., 'nyorai2')
    }

    currentDir = path.dirname(currentDir)
  }

  throw new Error('No directory named "projects" found in the path hierarchy.')
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

      await performRAG(query, indexName, chatHistory, {
        indexer: pc,
        embedder: openai,
        debugMode,
      })
      askQuestion()
    })
  }

  askQuestion()
}

async function main() {
  try {
    const projectRoot = findProjectRoot(directory)
    const indexName = projectRoot

    await initializePineconeIndex(indexName, { indexer: pc })

    if (queryMode) {
      await promptLoop(indexName)
    } else {
      const files = await readFilesRecursively(directory)
      await indexFiles(files, indexName, {
        indexer: pc,
        embedder: openai,
        dryrunMode,
      })
    }
  } catch (error) {
    console.error('An error occurred:', error)
  }
}

main().catch(console.error)
