import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { nord } from 'react-syntax-highlighter/dist/esm/styles/prism'

export const CodeBlock = ({ language, value }) => {
  return (
    <SyntaxHighlighter language={language} style={nord}>
      {value}
    </SyntaxHighlighter>
  )
}
