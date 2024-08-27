import { mean, median } from 'mathjs';
async function performRAG(query, indexName, chatHistory, { indexer: pc, embedder: openai, debugMode, }) {
    try {
        const queryEmbedding = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: query,
        });
        const queryVector = queryEmbedding.data[0].embedding;
        const index = pc.index(indexName);
        const searchResults = await index.query({
            vector: queryVector,
            topK: 20,
            includeMetadata: true,
        });
        const scores = searchResults.matches
            .map((match) => match.score)
            .filter((score) => score !== undefined);
        const meanScore = mean(scores);
        const medianScore = median(scores);
        const minContexts = 5;
        const maxContexts = 10;
        const relevantMatches = searchResults.matches
            .filter((match) => match.score !== undefined &&
            (match.score >= medianScore || match.score >= meanScore))
            .slice(0, maxContexts);
        const relevantContexts = relevantMatches
            .map((match) => match.metadata?.text)
            .filter(Boolean);
        while (relevantContexts.length < minContexts &&
            searchResults.matches.length > relevantContexts.length) {
            relevantContexts.push(searchResults.matches[relevantContexts.length].metadata?.text);
        }
        chatHistory.push({
            role: 'user',
            content: query,
        });
        chatHistory.push({
            role: 'assistant',
            content: `Here are some relevant contexts: ${relevantContexts.join('\n')}\n\nAnswer the following question: ${query}`,
        });
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
            const filesConsidered = relevantMatches
                .map((match) => match.metadata?.path)
                .filter(Boolean);
            console.log('\nFiles considered when answering the question:');
            filesConsidered.forEach((file) => console.log(file));
        }
    }
    catch (error) {
        console.error('Error during RAG process:', error);
    }
}
export { performRAG };
