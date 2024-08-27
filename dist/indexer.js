import fs from 'fs-extra';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cacheFilePath = path.resolve(__dirname, 'index_cache.json');
async function loadCache() {
    try {
        const cacheExists = await fs.pathExists(cacheFilePath);
        if (cacheExists) {
            const cache = await fs.readJson(cacheFilePath);
            return cache;
        }
        else {
            return {};
        }
    }
    catch (error) {
        console.error('Error loading cache:', error);
        throw error;
    }
}
async function saveCache(cache) {
    try {
        await fs.writeJson(cacheFilePath, cache, { spaces: 2 });
    }
    catch (error) {
        console.error('Error saving cache:', error);
        throw error;
    }
}
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
    '.temp',
]);
const allowedExtensions = new Set([
    '.json',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.md',
    '.tf',
    '.tfvars',
    '.hcl',
    '.pkr.hcl',
    '.Dockerfile',
    '.dockerignore',
    '.yml',
    '.yaml',
]);
async function readFilesRecursively(dir) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(entries.map(async (entry) => {
            const res = path.resolve(dir, entry.name);
            if (entry.isDirectory() &&
                (ignoredDirs.has(entry.name) || entry.name.startsWith('.'))) {
                return [];
            }
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
async function initializePineconeIndex(indexName, { indexer: pc }) {
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
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }
    }
    catch (error) {
        console.error('Error initializing Pinecone index:', error);
        throw error;
    }
}
async function indexFiles(files, indexName, { indexer: pc, embedder: openai, dryrunMode, }) {
    const cache = await loadCache();
    const index = pc.index(indexName);
    let successfulCount = 0;
    for (const file of files) {
        try {
            const stats = await fs.stat(file);
            const mdate = stats.mtimeMs;
            const cachedMdate = cache[file];
            if (cachedMdate && mdate <= cachedMdate) {
                console.log(`Skipping file: ${file} (not modified since last index)`);
                continue;
            }
            const content = await fs.readFile(file, 'utf8');
            const contentWithFilePath = `File path: ${file}\n\n${content}`;
            if (dryrunMode) {
                console.log(`[Dry Run] Indexed file: ${file}`);
            }
            else {
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
                            mdate,
                            text: contentWithFilePath,
                        },
                    },
                ]);
                console.log(`Indexed file: ${file}`);
                cache[file] = mdate;
            }
            successfulCount++;
        }
        catch (error) {
            console.error(`Error indexing file ${file}:`, error);
        }
    }
    await saveCache(cache);
    console.log(`Successfully ${dryrunMode ? 'simulated indexing' : 'indexed'} ${successfulCount} out of ${files.length} files in Pinecone under index '${indexName}'${dryrunMode ? ' (dry run)' : ''}`);
}
export { initializePineconeIndex, readFilesRecursively, indexFiles };