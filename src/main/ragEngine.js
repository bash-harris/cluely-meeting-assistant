/**
 * Local Document RAG Engine
 * Indexes pre-loaded documents and provides sub-millisecond top-k retrieval
 * for the LLM Context Router.
 */

const fs = require('fs');
const path = require('path');

class RAGEngine {
  constructor(docsFilePath = null) {
    this.documents = [];
    this.chunks = [];
    if (docsFilePath) {
      this.loadFromFile(docsFilePath);
    } else {
      const defaultDocs = path.join(__dirname, '../fixtures/sampleDocs.json');
      if (fs.existsSync(defaultDocs)) {
        this.loadFromFile(defaultDocs);
      }
    }
  }

  loadFromFile(filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      this.documents = Array.isArray(data) ? data : [data];
      this.indexDocuments();
    } catch (err) {
      console.error('[RAGEngine] Error loading docs:', err);
    }
  }

  addDocument(title, content, category = 'General') {
    const id = `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    this.documents.push({ id, title, content, category });
    this.indexDocuments();
  }

  tokenize(text) {
    return (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  indexDocuments() {
    this.chunks = [];
    for (const doc of this.documents) {
      // Split into sentence or 300-char paragraphs
      const sentences = doc.content.match(/[^.!?]+[.!?]+/g) || [doc.content];
      sentences.forEach((sent, idx) => {
        const trimmed = sent.trim();
        if (trimmed.length > 10) {
          this.chunks.push({
            id: `${doc.id}-chunk-${idx}`,
            docId: doc.id,
            title: doc.title,
            category: doc.category,
            text: trimmed,
            tokens: new Set(this.tokenize(trimmed + ' ' + doc.title + ' ' + doc.category))
          });
        }
      });
    }
  }

  /**
   * Retrieve top-k relevant chunks given a search query
   * @param {string} query 
   * @param {number} k 
   * @returns {Array<{ chunkId: string, title: string, text: string, score: number, category: string }>}
   */
  retrieveTopK(query, k = 3) {
    if (!query || this.chunks.length === 0) return [];

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    const scored = this.chunks.map(chunk => {
      let matchCount = 0;
      let titleBonus = 0;

      queryTokens.forEach(qToken => {
        if (chunk.tokens.has(qToken)) {
          matchCount += 1;
        }
        if (chunk.title.toLowerCase().includes(qToken)) {
          titleBonus += 0.5;
        }
      });

      // Simple Jaccard-like keyword affinity score + length normalization
      const score = (matchCount + titleBonus) / Math.sqrt(chunk.tokens.size + queryTokens.length);

      return {
        chunkId: chunk.id,
        title: chunk.title,
        category: chunk.category,
        text: chunk.text,
        score: Math.round(score * 100) / 100
      };
    });

    return scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  getAllDocuments() {
    return this.documents;
  }
}

module.exports = { RAGEngine };

