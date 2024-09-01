import { Pinecone } from '@pinecone-database/pinecone'
import OpenAI from 'openai'
import { Readable } from 'stream'

type RAGOptions = {
  indexer: Pinecone
  embedder: OpenAI
  debugMode: boolean
}

async function getQueryEmbedding(query: string, openai: OpenAI) {
  const queryEmbedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  })
  return queryEmbedding.data[0].embedding
}

async function getRelevantMatches(
  queryVector: number[],
  indexName: string,
  pc: Pinecone,
  previousResults: Set<string>
) {
  const index = pc.index(indexName)
  const searchResults = await index.query({
    vector: queryVector,
    topK: 10,
    includeMetadata: true,
  })

  const relevantMatches = searchResults.matches.filter(
    (match) => !previousResults.has(match.metadata?.path as string)
  )

  const matchesToUse =
    relevantMatches.length > 0 ? relevantMatches : searchResults.matches

  const relevantContexts = matchesToUse
    .map((match) => match.metadata?.text)
    .filter((text): text is string => Boolean(text))

  matchesToUse.forEach((match) => {
    previousResults.add(match.metadata?.path as string)
  })

  return relevantContexts
}

async function addQueryToHistory(
  query: string,
  relevantContexts: string[],
  chatHistory: any[]
) {
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
}

async function streamResponse(
  openai: OpenAI,
  chatHistory: any[],
  debugMode: boolean,
  previousResults: Set<string>
) {
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
    const filesConsidered = Array.from(previousResults)
    console.log('\nFiles considered when answering the question:')
    filesConsidered.forEach((file) => console.log(file))
    chatHistory.push({
      role: 'assistant',
      content: `Files considered when answering the question:\n${filesConsidered.join(
        '\n'
      )}`,
    })
  }

  return response.trim()
}

// might need to handle case where relevant contexts is empty
async function getSpecificFiles(
  indexName: string,
  pc: Pinecone,
  selectedFiles: string[],
  previousResults: Set<string>
) {
  const filteredSelectedFiles = selectedFiles.filter(
    (file) => !previousResults.has(file)
  )

  const index = pc.index(indexName)
  const specificResults = await index.fetch(filteredSelectedFiles)

  const specificFiles = Object.values(specificResults.records)
  const relevantContexts = specificFiles.map(
    (content) => content?.metadata?.text as string
  )

  const filePaths = specificFiles.map((file) => file.metadata?.path as string)
  filePaths.forEach((file) => {
    previousResults.add(file)
  })

  return relevantContexts
}

async function performRAGStream(
  query: string,
  indexName: string,
  chatHistory: any[],
  previousResults: Set<string>,
  selectedFiles: string[],
  options: RAGOptions
) {
  try {
    const { indexer: pc, embedder: openai } = options

    const queryVector = await getQueryEmbedding(query, openai)

    let relevantContexts: string[] = []

    if (selectedFiles.length > 0) {
      console.log('using selected files')
      relevantContexts = await getSpecificFiles(
        indexName,
        pc,
        selectedFiles,
        previousResults
      )
    } else {
      console.log('no files selected, using query files')
      relevantContexts = await getRelevantMatches(
        queryVector,
        indexName,
        pc,
        previousResults
      )
    }

    await addQueryToHistory(query, relevantContexts, chatHistory)

    const readableStream = Readable.from(
      await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: chatHistory,
        stream: true,
      })
    )

    return {
      readableStream,
      previousResults,
    }
  } catch (error) {
    console.error('Error during RAG process:', error)
  }
}

async function performRAG(
  query: string,
  indexName: string,
  chatHistory: any[],
  previousResults: Set<string>,
  options: RAGOptions
) {
  try {
    const { indexer: pc, embedder: openai, debugMode } = options

    const queryVector = await getQueryEmbedding(query, openai)
    const relevantContexts = await getRelevantMatches(
      queryVector,
      indexName,
      pc,
      previousResults
    )
    await addQueryToHistory(query, relevantContexts, chatHistory)

    return await streamResponse(openai, chatHistory, debugMode, previousResults)
  } catch (error) {
    console.error('Error during RAG process:', error)
  }
}

async function fileSearch(
  query: string,
  indexName: string,
  pc: Pinecone,
  openai: OpenAI
) {
  const index = pc.index(indexName)
  const queryEmbedding = await getQueryEmbedding(query, openai)

  const searchResults = await index.query({
    vector: queryEmbedding,
    topK: 10,
    includeMetadata: true,
  })

  const results = searchResults.matches.map((match) => ({
    filename: match.metadata?.path || 'Unknown',
    score: match.score || 0,
  }))

  return results
}

export { performRAG, performRAGStream, fileSearch }
