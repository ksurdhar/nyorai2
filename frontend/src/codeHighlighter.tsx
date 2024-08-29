import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { nord } from 'react-syntax-highlighter/dist/esm/styles/prism'

export const CodeBlock = ({ language, value }) => {
  const copyToClipboard = () => {
    navigator.clipboard.writeText(value).catch((err) => {
      console.error('Failed to copy: ', err)
    })
  }

  return (
    <div style={{ position: 'relative', marginBottom: '10px' }}>
      <button
        onClick={copyToClipboard}
        style={{ position: 'absolute', right: '10px', top: '10px' }}
      >
        Copy
      </button>
      <SyntaxHighlighter language={language} style={nord}>
        {value}
      </SyntaxHighlighter>
    </div>
  )
}
