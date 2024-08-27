import fs from 'fs-extra';
import * as path from 'path';
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
                await new Promise((resolve) => setTimeout(resolve, 5000));
            }
        }
    }
    catch (error) {
        console.error('Error initializing Pinecone index:', error);
        throw error;
    }
}
async function indexFiles(files, indexName, { indexer: pc, embedder: openai }) {
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
export { initializePineconeIndex, readFilesRecursively, indexFiles };
