async function performRAG(query, indexName, chatHistory, previousResults, { indexer: pc, embedder: openai, debugMode, }) {
    try {
        const queryEmbedding = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: query,
        });
        const queryVector = queryEmbedding.data[0].embedding;
        const index = pc.index(indexName);
        const searchResults = await index.query({
            vector: queryVector,
            topK: 10, // Fetch the top 10 results
            includeMetadata: true,
        });
        // Filter out results that were previously used
        const relevantMatches = searchResults.matches.filter((match) => !previousResults.has(match.metadata?.path));
        // If there are no new relevant matches, use all top 10 results regardless of previous use
        const matchesToUse = relevantMatches.length > 0 ? relevantMatches : searchResults.matches;
        const relevantContexts = matchesToUse
            .map((match) => match.metadata?.text)
            .filter(Boolean);
        // Add the paths of the matches to the previousResults set to avoid duplication in future queries
        matchesToUse.forEach((match) => {
            previousResults.add(match.metadata?.path);
        });
        // Add the user query to the chat history
        chatHistory.push({
            role: 'user',
            content: query,
        });
        // Add the relevant contexts to the chat history
        chatHistory.push({
            role: 'assistant',
            content: `Here are some relevant contexts: ${relevantContexts.join('\n')}\n\nAnswer the following question: ${query}`,
        });
        // Create a stream for the chat completion
        const stream = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: chatHistory,
            stream: true,
        });
        let response = '';
        // Process the streaming response
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            process.stdout.write(content);
            response += content;
        }
        console.log('\n');
        // Add the assistant's response to the chat history
        chatHistory.push({
            role: 'assistant',
            content: response.trim(),
        });
        // Debug mode: log the files considered for the response
        if (debugMode) {
            const filesConsidered = Array.from(previousResults);
            console.log('\nFiles considered when answering the question:');
            filesConsidered.forEach((file) => console.log(file));
            chatHistory.push({
                role: 'assistant',
                content: `Files considered when answering the question:\n${filesConsidered.join('\n')}`,
            });
        }
    }
    catch (error) {
        console.error('Error during RAG process:', error);
    }
}
export { performRAG };
