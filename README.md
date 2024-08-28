# nyorai2 - Talk to your codebase with AI

Use a LLM to index codebases and talk to an AI about them.

## Setup

You need a Pinecone API key, and an OpenAI API key. Grab those, and install the deps with `npm i`

### Running The UI

`PINECONE_API_KEY=asdf OPENAI_API_KEY=asdf npm start`

### Running The CLI

`npm link` will put it in your `$PATH`. Then you can run `PINECONE_API_KEY=asdf OPENAI_API_KEY=asdf nyorai2`.
