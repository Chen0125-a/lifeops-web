import { SOURCE_PATH_BY_KEY } from './constants.mjs'
import { sha256Text } from './load-json.mjs'

const ATX_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const LIST_ITEM = /^\s*(?:[-+*]|\d+[.)])\s+(.+)$/
const FENCE = /^\s*(`{3,}|~{3,})/

function normalizeMarkdown(markdown) {
  if (typeof markdown !== 'string') {
    throw new TypeError('Markdown source must be a string')
  }

  return markdown.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

function isTableRow(line) {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1
}

function isTableSeparator(line) {
  if (!isTableRow(line)) {
    return false
  }

  const cells = line.trim().slice(1, -1).split('|').map((cell) => cell.trim())
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function startsStructuralBlock(line) {
  return ATX_HEADING.test(line) || LIST_ITEM.test(line) || isTableRow(line) || FENCE.test(line)
}

export function extractClauseCandidates(sourceKey, markdown) {
  const sourcePath = SOURCE_PATH_BY_KEY[sourceKey]
  if (!sourcePath) {
    throw new Error(`Unknown source key: ${sourceKey}`)
  }

  const lines = normalizeMarkdown(markdown).split('\n')
  const headingStack = []
  const ordinals = new Map()
  const candidates = []
  let paragraphLines = []
  let activeFence = null

  const addCandidate = (kind, text) => {
    const normalizedText = text.trim()
    const headingPath = [...headingStack]
    const ordinalKey = `${headingPath.join('\u001F')}\u001E${kind}`
    const ordinal = (ordinals.get(ordinalKey) ?? 0) + 1
    ordinals.set(ordinalKey, ordinal)
    candidates.push({
      sourceKey,
      sourcePath,
      headingPath,
      kind,
      ordinal,
      text: normalizedText,
      textSha256: sha256Text(normalizedText),
    })
  }

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return
    }

    addCandidate('paragraph', paragraphLines.join('\n'))
    paragraphLines = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = line.match(FENCE)

    if (activeFence) {
      if (fenceMatch && fenceMatch[1][0] === activeFence.marker && fenceMatch[1].length >= activeFence.length) {
        activeFence = null
      }
      continue
    }

    if (fenceMatch) {
      flushParagraph()
      activeFence = { marker: fenceMatch[1][0], length: fenceMatch[1].length }
      continue
    }

    const headingMatch = line.match(ATX_HEADING)
    if (headingMatch) {
      flushParagraph()
      const level = headingMatch[1].length
      const headingText = headingMatch[2].trim()
      headingStack.splice(level - 1)
      headingStack.push(headingText)
      addCandidate('heading', headingText)
      continue
    }

    const listMatch = line.match(LIST_ITEM)
    if (listMatch) {
      flushParagraph()
      const itemLines = [listMatch[1].trimEnd()]
      if (/^P[1-6]$/.test(sourceKey)) {
        itemLines[0] = itemLines[0].replace(/^\[[ xX]\](?=\s)/, '[ ]')
      }
      while (index + 1 < lines.length) {
        const continuation = lines[index + 1]
        if (continuation.trim() === '' || startsStructuralBlock(continuation)) {
          break
        }
        if (!/^\s+/.test(continuation)) {
          break
        }
        itemLines.push(continuation.trim())
        index += 1
      }
      addCandidate('list-item', itemLines.join('\n'))
      continue
    }

    if (isTableRow(line)) {
      flushParagraph()
      if (!isTableSeparator(line)) {
        addCandidate('table-row', line.trim())
      }
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      continue
    }

    paragraphLines.push(line.trim())
  }

  flushParagraph()
  return candidates
}
