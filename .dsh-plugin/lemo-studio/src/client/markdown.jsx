import React from 'react'

/** A small, deliberate Markdown renderer for TREATMENT.md — headings, lists, quotes, tables, code. */
export default function Markdown({ text }) {
  const blocks = String(text || '').split(/\n{2,}/)
  const out = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim()
    if (!block) continue
    if (/^-{3,}$/.test(block)) {
      out.push(<hr key={i} />)
      continue
    }
    if (block.startsWith('```')) {
      out.push(<pre key={i} className="ls-md-code">{block.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '')}</pre>)
      continue
    }
    const lines = block.split('\n')
    if (lines[0].startsWith('#')) {
      const level = Math.min(4, (lines[0].match(/^#+/) || ['#'])[0].length)
      const Tag = `h${Math.min(6, level + 2)}`
      out.push(<Tag key={i}>{inline(lines[0].replace(/^#+\s*/, ''))}</Tag>)
      const rest = lines.slice(1)
      if (rest.length) out.push(<p key={`${i}-rest`}>{rest.map((line, j) => <React.Fragment key={j}>{inline(line)}{j < rest.length - 1 ? <br /> : null}</React.Fragment>)}</p>)
      continue
    }
    if (lines.every((line) => /^\s*>/.test(line))) {
      out.push(<blockquote key={i}>{lines.map((line) => line.replace(/^\s*>\s?/, '')).join(' ')}</blockquote>)
      continue
    }
    if (lines.every((line) => /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line))) {
      const ordered = /^\s*\d+\./.test(lines[0])
      const Tag = ordered ? 'ol' : 'ul'
      out.push(
        <Tag key={i}>
          {lines.map((line, j) => <li key={j}>{inline(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))}</li>)}
        </Tag>,
      )
      continue
    }
    if (lines.length >= 2 && /^\s*\|/.test(lines[0]) && /^\s*\|?[\s:|-]+\|/.test(lines[1])) {
      const rows = lines.filter((line) => /^\s*\|/.test(line))
      const head = rows[0].split('|').slice(1, -1).map((cell) => cell.trim())
      const body = rows.slice(2).map((row) => row.split('|').slice(1, -1).map((cell) => cell.trim()))
      out.push(
        <div className="ls-md-table" key={i}>
          <table>
            <thead><tr>{head.map((cell, j) => <th key={j}>{inline(cell)}</th>)}</tr></thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}>{inline(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    out.push(
      <p key={i}>
        {lines.map((line, j) => (
          <React.Fragment key={j}>
            {inline(line)}
            {j < lines.length - 1 ? <br /> : null}
          </React.Fragment>
        ))}
      </p>,
    )
  }
  return <div className="ls-md">{out}</div>
}

function inline(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <b key={i}>{part.slice(2, -2)}</b>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}
