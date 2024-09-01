import { Readable } from 'stream';
async function getQueryEmbedding(query, openai) {
    const queryEmbedding = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: query,
    });
    return queryEmbedding.data[0].embedding;
}
async function getRelevantMatches(queryVector, indexName, pc, previousResults) {
    const index = pc.index(indexName);
    const searchResults = await index.query({
        vector: queryVector,
        topK: 10,
        includeMetadata: true,
    });
    const relevantMatches = searchResults.matches.filter((match) => !previousResults.has(match.metadata?.path));
    const matchesToUse = relevantMatches.length > 0 ? relevantMatches : searchResults.matches;
    const relevantContexts = matchesToUse
        .map((match) => match.metadata?.text)
        .filter((text) => Boolean(text));
    matchesToUse.forEach((match) => {
        previousResults.add(match.metadata?.path);
    });
    return relevantContexts;
}
async function addQueryToHistory(query, relevantContexts, chatHistory) {
    chatHistory.push({
        role: 'user',
        content: query,
    });
    chatHistory.push({
        role: 'assistant',
        content: `Here are some relevant contexts: ${relevantContexts.join('\n')}\n\nAnswer the following question: ${query}`,
    });
}
async function streamResponse(openai, chatHistory, debugMode, previousResults) {
    const stream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: chatHistory,
        stream: true,
    });
    let response = '';
    for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        process.stdout.write(content);
        response += content;
    }
    console.log('\n');
    chatHistory.push({
        role: 'assistant',
        content: response.trim(),
    });
    if (debugMode) {
        const filesConsidered = Array.from(previousResults);
        console.log('\nFiles considered when answering the question:');
        filesConsidered.forEach((file) => console.log(file));
        chatHistory.push({
            role: 'assistant',
            content: `Files considered when answering the question:\n${filesConsidered.join('\n')}`,
        });
    }
    return response.trim();
}
async function performRAGStream(query, indexName, chatHistory, previousResults, options) {
    try {
        const { indexer: pc, embedder: openai } = options;
        const queryVector = await getQueryEmbedding(query, openai);
        const relevantContexts = await getRelevantMatches(queryVector, indexName, pc, previousResults);
        await addQueryToHistory(query, relevantContexts, chatHistory);
        const readableStream = Readable.from(await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: chatHistory,
            stream: true,
        }));
        return {
            readableStream,
            previousResults,
        };
    }
    catch (error) {
        console.error('Error during RAG process:', error);
    }
}
async function performRAG(query, indexName, chatHistory, previousResults, options) {
    try {
        const { indexer: pc, embedder: openai, debugMode } = options;
        const queryVector = await getQueryEmbedding(query, openai);
        const relevantContexts = await getRelevantMatches(queryVector, indexName, pc, previousResults);
        await addQueryToHistory(query, relevantContexts, chatHistory);
        return await streamResponse(openai, chatHistory, debugMode, previousResults);
    }
    catch (error) {
        console.error('Error during RAG process:', error);
    }
}
async function fileSearch(query, indexName, pc, openai) {
    const index = pc.index(indexName);
    const queryEmbedding = await getQueryEmbedding(query, openai);
    const searchResults = await index.query({
        vector: queryEmbedding,
        topK: 10,
        includeMetadata: true,
    });
    const results = searchResults.matches.map((match) => ({
        filename: match.metadata?.path || 'Unknown',
        score: match.score || 0,
    }));
    return results;
}
export { performRAG, performRAGStream, fileSearch };
