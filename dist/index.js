#!/usr/bin/env node
import { Command } from 'commander';
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import * as path from 'path';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Explicitly specify the path to the .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const pineconeApiKey = process.env.PINECONE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
// Ensure the API keys are being loaded
if (!pineconeApiKey || !openaiApiKey) {
    throw new Error('API keys are missing! Check your .env file.');
}
// Initialize Pinecone and OpenAI
const pc = new Pinecone({
    apiKey: pineconeApiKey,
});
const openai = new OpenAI({
    apiKey: openaiApiKey,
});
const program = new Command();
program
    .option('-d, --dir <directory>', 'Directory to index')
    .parse(process.argv);
const options = program.opts();
const directory = options.dir || process.cwd();
function findProjectRoot(dir) {
    let currentDir = dir;
    while (currentDir !== path.parse(currentDir).root) {
        const parentDir = path.basename(currentDir);
        if (parentDir.toLowerCase() === 'projects') {
            return path.basename(path.dirname(currentDir));
        }
        currentDir = path.dirname(currentDir);
    }
    throw new Error('No directory named "project" found in the path hierarchy.');
}
async function initializePineconeIndex(indexName) {
    try {
        const { indexes: existingIndexes } = await pc.listIndexes();
        const indexNames = existingIndexes?.map((index) => index.name);
        if (!indexNames || !indexNames.includes(indexName)) {
            await pc.createIndex({
                name: indexName,
                dimension: 1536, // Dimension of OpenAI embeddings
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
            const embedding = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: content,
            });
            await index.upsert([
                {
                    id: file,
                    values: embedding.data[0].embedding,
                },
            ]);
            console.log(`Indexed file: ${file}`);
        }
        catch (error) {
            console.error(`Error indexing file ${file}:`, error);
        }
    }
}
async function main() {
    try {
        const rootDirName = findProjectRoot(directory);
        const lastDirName = path.basename(directory);
        const indexName = `${rootDirName}-${lastDirName}`;
        await initializePineconeIndex(indexName);
        const files = await readFilesRecursively(directory);
        await indexFiles(files, indexName);
        console.log(`Successfully indexed ${files.length} files in Pinecone under index '${indexName}'`);
    }
    catch (error) {
        console.error('An error occurred:', error);
    }
}
main().catch(console.error);
