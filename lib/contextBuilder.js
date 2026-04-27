/**
 * Builds LLM prompts with document context.
 * Manages context window limits by truncating intelligently.
 */

/**
 * Approximate token count (rough: ~4 chars per token for English text).
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Build a system prompt that includes document context.
 * @param {Array} documents - Array of { name, type, content } objects
 * @param {number} maxTokens - Maximum tokens for the context
 * @returns {string} System prompt with document context
 */
function buildSystemPrompt(documents, maxTokens = 8192) {
  const basePrompt = `You are Documentor, an intelligent document analysis assistant. You have access to the following documents from the user's local folder. Use this information to answer questions accurately and thoroughly.

When answering:
- Reference specific documents by name when citing information
- If data comes from a table or spreadsheet, format your response with proper tables
- If you're unsure or the documents don't contain enough information, say so
- You can compare data across multiple documents
- When generating reports, be comprehensive and well-structured

`;

  const baseTokens = estimateTokens(basePrompt);
  let remainingTokens = maxTokens - baseTokens - 500; // Reserve 500 for user message overhead

  if (!documents || documents.length === 0) {
    return basePrompt + 'No documents have been loaded yet. Ask the user to configure a folder path in the settings panel.';
  }

  // Build document summaries first (lightweight)
  let documentIndex = '\n## Available Documents:\n';
  for (const doc of documents) {
    documentIndex += `- **${doc.name}** (${doc.type}, ${doc.wordCount || 0} words)\n`;
  }
  documentIndex += '\n## Document Contents:\n\n';

  const indexTokens = estimateTokens(documentIndex);
  remainingTokens -= indexTokens;

  // Distribute remaining tokens across documents
  const tokensPerDoc = Math.floor(remainingTokens / documents.length);
  let documentContents = '';

  for (const doc of documents) {
    const docHeader = `### 📄 ${doc.name} (${doc.type})\n`;
    const headerTokens = estimateTokens(docHeader);
    const contentBudget = tokensPerDoc - headerTokens;

    let content = doc.content || '';
    const contentTokens = estimateTokens(content);

    if (contentTokens > contentBudget) {
      // Truncate content to fit budget
      const maxChars = contentBudget * 4;
      content = content.substring(0, maxChars) + '\n... [Content truncated due to length] ...';
    }

    documentContents += docHeader + content + '\n\n';
  }

  return basePrompt + documentIndex + documentContents;
}

/**
 * Build a report generation prompt.
 */
function buildReportPrompt(documents) {
  return `Based on ALL the documents provided, generate a comprehensive analysis report. The report should include:

1. **Executive Summary** — High-level overview of all documents
2. **Document Inventory** — List of all documents with key metadata
3. **Key Findings** — Important data points, trends, or information found
4. **Cross-Document Analysis** — Relationships or patterns across documents
5. **Data Summary** — Key statistics, totals, or aggregated data from spreadsheets
6. **Recommendations** — Any actionable insights based on the document analysis

Format the report professionally with markdown headings, tables where appropriate, and clear sections.`;
}

module.exports = { buildSystemPrompt, buildReportPrompt, estimateTokens };
