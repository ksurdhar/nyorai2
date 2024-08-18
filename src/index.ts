#!/usr/bin/env node

import { Command } from 'commander'
import { Pinecone, IndexModel } from '@pinecone-database/pinecone'
import dotenv from 'dotenv'
import * as fs from 'fs-extra'
import * as path from 'path'
import OpenAI from 'openai'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Explicitly specify the path to the .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const pineconeApiKey = process.env.PINECONE_API_KEY
const openaiApiKey = process.env.OPENAI_API_KEY

// Ensure the API keys are being loaded
if (!pineconeApiKey || !openaiApiKey) {
  throw new Error('API keys are missing! Check your .env file.')
}

// Initialize Pinecone and OpenAI
const pc = new Pinecone({
  apiKey: pineconeApiKey as string,
})

const openai = new OpenAI({
  apiKey: openaiApiKey as string,
})

const program = new Command()

program
  .option('-d, --dir <directory>', 'Directory to index')
  .parse(process.argv)

const options = program.opts()
const directory = options.dir || process.cwd()

async function initializePineconeIndex(indexName: string) {
  const { indexes: existingIndexes } = await pc.listIndexes()
  const indexNames = existingIndexes?.map((index) => index.name)

  if (!indexNames || !indexNames.includes(indexName)) {
    await pc.createIndex({
      name: indexName,
      dimension: 1536, // Dimension of OpenAI embeddings
      spec: { serverless: { cloud: 'aws', region: 'us-west-2' } },
    })
  }
}

async function readFilesRecursively(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const res = path.resolve(dir, entry.name)
      return entry.isDirectory() ? readFilesRecursively(res) : [res]
    })
  )
  return files.flat()
}

async function indexFiles(files: string[], indexName: string) {
  const index = pc.index(indexName)

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8')
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: content,
    })

    await index.upsert([
      {
        id: file,
        values: embedding.data[0].embedding,
      },
    ])
  }
}

async function main() {
  const indexName = path.basename(directory)
  await initializePineconeIndex(indexName)

  const files = await readFilesRecursively(directory)
  await indexFiles(files, indexName)

  console.log(
    `Indexed ${files.length} files in Pinecone under index '${indexName}'`
  )
}

main().catch(console.error)
