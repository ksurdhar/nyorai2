import { Pinecone } from '@pinecone-database/pinecone'
import { mean, median } from 'mathjs'
import OpenAI from 'openai'

async function performRAG(
  query: string,
  indexName: string,
  chatHistory: any[],
  previousResults: Set<string>,
  {
    indexer: pc,
    embedder: openai,
    debugMode,
  }: { indexer: Pinecone; embedder: OpenAI; debugMode: boolean }
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

    const scores = searchResults.matches
      .map((match) => match.score)
      .filter((score): score is number => score !== undefined)

    const meanScore = mean(scores)
    const medianScore = median(scores)

    const minContexts = 5
    const maxContexts = 10

    const relevantMatches = searchResults.matches
      .filter(
        (match) =>
          match.score !== undefined &&
          (match.score >= medianScore || match.score >= meanScore) &&
          !previousResults.has(match.metadata?.path as string)
      )
      .slice(0, maxContexts)

    const relevantContexts = relevantMatches
      .map((match) => match.metadata?.text)
      .filter(Boolean)

    while (
      relevantContexts.length < minContexts &&
      searchResults.matches.length > relevantContexts.length
    ) {
      const match = searchResults.matches[relevantContexts.length]
      if (!previousResults.has(match.metadata?.path as string)) {
        relevantContexts.push(match.metadata?.text)
      }
    }

    relevantMatches.forEach((match) => {
      previousResults.add(match.metadata?.path as string)
    })

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
  } catch (error) {
    console.error('Error during RAG process:', error)
  }
}

export { performRAG }
