#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import * as path from 'path';
import * as readline from 'readline';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { median, mean } from 'mathjs';
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
    .option('--debug', 'Enable debug mode')
    .parse(process.argv);
const options = program.opts();
const directory = options.dir || process.cwd();
const queryMode = options.query || false;
const debugMode = options.debug || false;
const ignoredDirs = new Set([
    'node_modules',
    '.git',
    '.vscode',
    'dist',
    'build',
    'coverage',
    'logs',
    'tmp',
    'temp',
]);
const allowedExtensions = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.md',
    // '.json',
    '.tf', // Terraform
    '.tfvars', // Terraform variable files
    '.hcl', // HashiCorp Configuration Language
    '.pkr.hcl', // Packer configuration files
    '.Dockerfile', // Dockerfile
    '.dockerignore',
    '.yml',
    '.yaml',
]);
function findProjectRoot(dir) {
    let currentDir = dir;
    while (currentDir !== path.parse(currentDir).root) {
        const parentDir = path.basename(path.dirname(currentDir));
        if (parentDir.toLowerCase() === 'projects') {
            return path.basename(currentDir); // Return only the project root (e.g., 'nyorai2')
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
        let isReady = false;
        while (!isReady) {
            const indexDescription = await pc.describeIndex(indexName);
            if (indexDescription.status.ready === true) {
                isReady = true;
            }
            else {
                console.log(`Waiting for Pinecone index '${indexName}' to be ready...`);
                await new Promise((resolve) => setTimeout(resolve, 5000));
            }
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
            // Skip ignored directories
            if (entry.isDirectory() && ignoredDirs.has(entry.name)) {
                return [];
            }
            // Filter by allowed file extensions
            if (!entry.isDirectory() &&
                !allowedExtensions.has(path.extname(entry.name))) {
                return [];
            }
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
    const namespaces = new Set();
    for (const file of files) {
        try {
            const relativePath = path.relative(directory, file);
            const topLevelDir = relativePath.split(path.sep)[0] || indexName;
            const content = await fs.readFile(file, 'utf8');
            const contentWithFilePath = `File path: ${file}\n\n${content}`;
            const embedding = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: contentWithFilePath,
            });
            await index.namespace(topLevelDir).upsert([
                {
                    id: file,
                    values: embedding.data[0].embedding,
                    metadata: {
                        path: file,
                        text: contentWithFilePath,
                    },
                },
            ]);
            namespaces.add(topLevelDir);
            console.log(`Indexed file: ${file} under namespace: '${topLevelDir}'`);
        }
        catch (error) {
            console.error(`Error indexing file ${file}:`, error);
        }
    }
    return namespaces;
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
            askQuestion();
        });
    };
    askQuestion();
}
async function main() {
    try {
        const projectRoot = findProjectRoot(directory);
        const indexName = projectRoot;
        await initializePineconeIndex(indexName);
        if (queryMode) {
            await promptLoop(indexName);
        }
        else {
            const files = await readFilesRecursively(directory);
            const namespaces = await indexFiles(files, indexName);
            console.log(`Successfully indexed ${files.length} files in Pinecone under index '${indexName}' and namespaces '${namespaces}'`);
        }
    }
    catch (error) {
        console.error('An error occurred:', error);
    }
}
main().catch(console.error);
