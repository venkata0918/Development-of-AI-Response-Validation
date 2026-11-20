import { apiClient } from './apiClient';
import { KBDocument, RetrievalQueryResult } from '../types/knowledgeBase';

interface ApiDocument {
  id: number;
  name: string;
  corpus: string;
  n_chunks: number;
  created_at: string;
}

interface ApiChunk {
  id: number;
  idx: number;
  text: string;
}

interface ApiSearchResult {
  chunk_id: number;
  doc_id: number;
  chunk_index: number;
  doc: string;
  source: string;
  text: string;
  similarity: number;
}

const fileType = (name: string): KBDocument['fileType'] => {
  const extension = name.split('.').pop()?.toUpperCase();
  return extension === 'PDF' || extension === 'MD' || extension === 'JSON' ? extension : 'TXT';
};

const toDocument = (document: ApiDocument): KBDocument => ({
  id: String(document.id),
  name: document.name,
  fileType: fileType(document.name),
  uploadDate: document.created_at,
  status: 'Indexed',
  chunkCount: document.n_chunks,
  indexStatus: 'Indexed Chunks',
  description: `Corpus: ${document.corpus}`,
  category: document.corpus,
});

export const knowledgeBaseService = {
  getAll: async (): Promise<KBDocument[]> => {
    const docs = await apiClient.get<ApiDocument[]>('/api/knowledge/documents');
    return Promise.all(docs.map(async document => {
      const doc = toDocument(document);
      const chunks = await apiClient.get<ApiChunk[]>(`/api/knowledge/documents/${document.id}/chunks`);
      doc.chunks = chunks.map(chunk => ({
        id: String(chunk.id),
        chunkIndex: chunk.idx + 1,
        content: chunk.text,
        tokenCount: chunk.text.split(/\s+/).filter(Boolean).length,
        embeddingVectorPreview: [],
      }));
      return doc;
    }));
  },

  addDocument: async (name: string, text: string, corpus = 'demo', file?: File): Promise<KBDocument> => {
    let document: ApiDocument;
    if (file) {
      const body = new FormData();
      body.append('file', file);
      body.append('corpus', corpus);
      document = await apiClient.post<ApiDocument>('/api/knowledge/documents', body);
    } else {
      document = await apiClient.post<ApiDocument>('/api/knowledge/documents/text', { name, corpus, text });
    }
    return toDocument(document);
  },

  deleteDocument: async (id: string): Promise<boolean> => {
    await apiClient.delete(`/api/knowledge/documents/${encodeURIComponent(id)}`);
    return true;
  },

  reindexDocument: async (id: string): Promise<KBDocument | null> => {
    await apiClient.post(`/api/knowledge/documents/${encodeURIComponent(id)}/reindex`, {});
    return (await knowledgeBaseService.getAll()).find(document => document.id === id) || null;
  },

  testRetrieval: async (query: string, corpus?: string): Promise<RetrievalQueryResult[]> => {
    const response = await apiClient.post<{ results: ApiSearchResult[] }>('/api/knowledge/search', {
      query,
      corpus: corpus || null,
      top_k: 4,
    });
    return response.results.map(result => ({
      chunkId: String(result.chunk_id),
      documentName: result.source || result.doc,
      content: result.text,
      similarityScore: result.similarity,
      tokenCount: result.text.split(/\s+/).filter(Boolean).length,
      isSimulated: false,
    }));
  },
};
