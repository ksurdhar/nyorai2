#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import * as path from 'path';
import * as readline from 'readline';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pineconeApiKey = process.env.PINECONE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
if (!pineconeApiKey || !openaiApiKey) {
    throw new Error('API keys are missing! Check your .env file.');
}
const pc = new Pinecone({
    apiKey: pineconeApiKey,
});
const openai = new OpenAI({
    apiKey: openaiApiKey,
});
const program = new Command();
program
    .option('-d, --dir <directory>', 'Directory to index')
    .option('-q, --query', 'Activate query prompt mode')
    .parse(process.argv);
const options = program.opts();
const directory = options.dir || process.cwd();
const queryMode = options.query || false;
function findProjectRoot(dir) {
    let currentDir = dir;
    while (currentDir !== path.parse(currentDir).root) {
        const parentDir = path.basename(path.dirname(currentDir));
        if (parentDir.toLowerCase() === 'projects') {
            const immediateDir = path.basename(currentDir);
            return [immediateDir, path.basename(dir)];
        }
        currentDir = path.dirname(currentDir);
    }
    throw new Error('No directory named "projects" found in the path hierarchy.');
}
async function initializePineconeIndex(indexName) {
    try {
        const { indexes: existingIndexes } = await pc.listIndexes();
        const indexNames = existingIndexes?.map((index) => index.name);
        if (!indexNames || !indexNames.includes(indexName)) {
            await pc.createIndex({
                name: indexName,
                dimension: 1536,
                spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
            });
        }
    }
    catch (error) {
        console.error('Error initializing Pinecone index:', error);
        throw error;
    }
}
async function readFilesRecursively(dir) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(entries.map(async (entry) => {
            const res = path.resolve(dir, entry.name);
            return entry.isDirectory() ? readFilesRecursively(res) : [res];
        }));
        return files.flat();
    }
    catch (error) {
        console.error('Error reading files:', error);
        throw error;
    }
}
async function indexFiles(files, indexName) {
    const index = pc.index(indexName);
    for (const file of files) {
        try {
            const content = await fs.readFile(file, 'utf8');
            const contentWithFilePath = `File path: ${file}\n\n${content}`;
            const embedding = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: contentWithFilePath,
            });
            await index.upsert([
                {
                    id: file,
                    values: embedding.data[0].embedding,
                    metadata: {
                        path: file,
                        text: contentWithFilePath,
                    },
                },
            ]);
            console.log(`Indexed file: ${file}`);
        }
        catch (error) {
            console.error(`Error indexing file ${file}:`, error);
        }
    }
}
async function performRAG(query, indexName, chatHistory) {
    try {
        const queryEmbedding = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: query,
        });
        const queryVector = queryEmbedding.data[0].embedding;
        const index = pc.index(indexName);
        const searchResults = await index.query({
            vector: queryVector,
            topK: 5,
            includeMetadata: true,
        });
        const relevantContexts = searchResults.matches
            .map((match) => match.metadata?.text)
            .filter(Boolean);
        chatHistory.push({
            role: 'user',
            content: query,
        });
        chatHistory.push({
            role: 'assistant',
            content: `Here are some relevant contexts: ${relevantContexts.join('\n')}\n\nAnswer the following question: ${query}`,
        });
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: chatHistory,
        });
        const response = completion.choices[0]?.message?.content?.trim() ??
            'No response generated.';
        if (response === 'No response generated.') {
            console.warn('Warning: The response content was null or undefined.');
        }
        else {
            chatHistory.push({
                role: 'assistant',
                content: response,
            });
        }
        console.log('Answer:', response);
    }
    catch (error) {
        console.error('Error during RAG process:', error);
    }
}
async function promptLoop(indexName) {
    const chatHistory = [
        {
            role: 'system',
            content: 'You are a helpful assistant knowledgeable about codebases.',
        },
    ];
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const askQuestion = () => {
        rl.question('Ask a question or type "exit" to quit: ', async (query) => {
            if (query.toLowerCase() === 'exit') {
                rl.close();
                return;
            }
            await performRAG(query, indexName, chatHistory);
            askQuestion(); // Continue the loop
        });
    };
    askQuestion(); // Start the loop
}
async function main() {
    try {
        const [parentDir, currentDir] = findProjectRoot(directory);
        const indexName = `${parentDir}-${currentDir}`;
        await initializePineconeIndex(indexName);
        if (queryMode) {
            await promptLoop(indexName);
        }
        else {
            const files = await readFilesRecursively(directory);
            await indexFiles(files, indexName);
            console.log(`Successfully indexed ${files.length} files in Pinecone under index '${indexName}'`);
        }
    }
    catch (error) {
        console.error('An error occurred:', error);
    }
}
main().catch(console.error);
