/**
 * DOCX generator using the `docx` npm package.
 * Part of Epic #2475, Issue #2477.
 *
 * Converts markdown to a Word document with proper formatting.
 */

import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  TableRow,
  TableCell,
  Table,
  WidthType,
} from 'docx';
import type { DocxGeneratorInput } from '../types.ts';

/** Heading level mapping */
const HEADING_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

/** Parse inline formatting from a text string */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Simple regex-based inline parsing for bold, italic, code, links
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__|_[^_]+_|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/);

  for (const part of parts) {
    if (!part) continue;

    // Bold
    if (/^\*\*(.+)\*\*$/.test(part) || /^__(.+)__$/.test(part)) {
      const inner = part.replace(/^\*\*|\*\*$|^__|__$/g, '');
      runs.push(new TextRun({ text: inner, bold: true }));
    }
    // Italic
    else if (/^\*(.+)\*$/.test(part) || /^_(.+)_$/.test(part)) {
      const inner = part.replace(/^\*|\*$|^_|_$/g, '');
      runs.push(new TextRun({ text: inner, italics: true }));
    }
    // Inline code
    else if (/^`(.+)`$/.test(part)) {
      const inner = part.replace(/^`|`$/g, '');
      runs.push(new TextRun({ text: inner, font: 'Courier New', size: 20 }));
    }
    // Link [text](url)
    else if (/^\[([^\]]+)\]\(([^)]+)\)$/.test(part)) {
      const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (match) {
        runs.push(new TextRun({ text: match[1], color: '0066CC', underline: {} }));
      }
    }
    // Plain text
    else {
      runs.push(new TextRun({ text: part }));
    }
  }

  return runs.length > 0 ? runs : [new TextRun({ text })];
}

/** Parse a markdown table into rows */
function parseTable(lines: string[]): Table | null {
  if (lines.length < 2) return null;

  const parseRow = (line: string): string[] =>
    line.split('|').map((c) => c.trim()).filter((c) => c.length > 0);

  const headerCells = parseRow(lines[0]);
  // Skip separator line (lines[1])
  const dataRows = lines.slice(2).map(parseRow);

  const rows = [
    new TableRow({
      children: headerCells.map(
        (cell) =>
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: cell, bold: true })] })],
            width: { size: Math.floor(100 / headerCells.length), type: WidthType.PERCENTAGE },
          }),
      ),
    }),
    ...dataRows.map(
      (cells) =>
        new TableRow({
          children: cells.map(
            (cell) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: cell })] })],
                width: { size: Math.floor(100 / headerCells.length), type: WidthType.PERCENTAGE },
              }),
          ),
        }),
    ),
  ];

  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

/**
 * Converts markdown to a DOCX document buffer.
 *
 * @param input - Markdown string and optional metadata
 * @returns DOCX binary as Buffer
 */
export async function generateDocx(input: DocxGeneratorInput): Promise<Buffer> {
  const lines = input.markdown.split('\n');
  const children: (Paragraph | Table)[] = [];
  let i = 0;
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: codeBlockLines.join('\n'),
                font: 'Courier New',
                size: 18,
              }),
            ],
            border: {
              top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
              left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
              right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
            },
            shading: { fill: 'F5F5F5' },
          }),
        );
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = HEADING_MAP[level] ?? HeadingLevel.HEADING_4;
      children.push(
        new Paragraph({
          heading,
          children: parseInlineFormatting(headingMatch[2]),
        }),
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
      children.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } },
          children: [new TextRun({ text: '' })],
        }),
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const text = line.slice(2);
      children.push(
        new Paragraph({
          children: [new TextRun({ text, italics: true, color: '555555' })],
          indent: { left: 720 },
          border: { left: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
        }),
      );
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      const text = line.replace(/^[-*+]\s+/, '');
      children.push(
        new Paragraph({
          children: parseInlineFormatting(text),
          bullet: { level: 0 },
        }),
      );
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (olMatch) {
      children.push(
        new Paragraph({
          children: parseInlineFormatting(olMatch[1]),
          numbering: { reference: 'default-numbering', level: 0 },
        }),
      );
      i++;
      continue;
    }

    // Table detection
    if (line.includes('|') && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1])) {
      const tableLines: string[] = [line];
      let j = i + 1;
      while (j < lines.length && lines[j].includes('|')) {
        tableLines.push(lines[j]);
        j++;
      }
      const table = parseTable(tableLines);
      if (table) children.push(table);
      i = j;
      continue;
    }

    // Regular paragraph
    children.push(new Paragraph({ children: parseInlineFormatting(line) }));
    i++;
  }

  // If we ended inside a code block, flush remaining
  if (inCodeBlock && codeBlockLines.length > 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: codeBlockLines.join('\n'), font: 'Courier New', size: 18 }),
        ],
        shading: { fill: 'F5F5F5' },
      }),
    );
  }

  const doc = new Document({
    creator: input.metadata?.author ?? 'OpenClaw Projects',
    title: input.metadata?.title ?? 'Exported Document',
    description: 'Generated by OpenClaw Projects export service',
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
