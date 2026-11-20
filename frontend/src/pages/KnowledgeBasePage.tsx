import React, { useState, useEffect } from 'react';
import {
  Database,
  Upload,
  FileText,
  Search,
  RefreshCw,
  Trash2,
  Eye,
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  Sliders,
  Layers,
  Sparkles,
  Info
} from 'lucide-react';
import { knowledgeBaseService } from '../services/knowledgeBaseService';
import { KBDocument, DocumentChunk, RetrievalQueryResult } from '../types/knowledgeBase';
import { Modal } from '../components/shared/Modal';

export const KnowledgeBasePage: React.FC = () => {
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');

  // Upload modal state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFileType, setUploadFileType] = useState<'PDF' | 'TXT' | 'DOCX' | 'MD' | 'JSON'>('PDF');
  const [uploadPreview, setUploadPreview] = useState('');
  const [uploadCorpus, setUploadCorpus] = useState('demo');
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Chunk view modal state
  const [selectedDoc, setSelectedDoc] = useState<KBDocument | null>(null);

  // Retrieval Tester state
  const [testQuery, setTestQuery] = useState('');
  const [retrievalResults, setRetrievalResults] = useState<RetrievalQueryResult[]>([]);
  const [isTestingRetrieval, setIsTestingRetrieval] = useState(false);

  const fetchDocs = async () => {
    setLoading(true);
    try {
      setDocuments(await knowledgeBaseService.getAll());
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not load knowledge documents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFileName.trim() || (!uploadFile && !uploadPreview.trim())) {
      setErrorMessage('Choose a supported file or provide document text.');
      return;
    }

    setIsUploading(true);
    try {
      await knowledgeBaseService.addDocument(
        uploadFileName.trim(),
        uploadPreview.trim(),
        uploadCorpus.trim() || 'demo',
        uploadFile || undefined
      );
      setIsUploadModalOpen(false);
      setUploadFileName('');
      setUploadPreview('');
      setUploadFile(null);
      await fetchDocs();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Document ingestion failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDoc = async (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete "${name}" from the vector index?`)) {
      try {
        await knowledgeBaseService.deleteDocument(id);
        await fetchDocs();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Document deletion failed.');
      }
    }
  };

  const handleReindex = async (id: string) => {
    try {
      await knowledgeBaseService.reindexDocument(id);
      await fetchDocs();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Document reindexing failed.');
    }
  };

  const handleTestRetrieval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testQuery.trim()) return;

    setIsTestingRetrieval(true);
    try {
      setRetrievalResults(await knowledgeBaseService.testRetrieval(testQuery.trim()));
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Evidence search failed.');
    } finally {
      setIsTestingRetrieval(false);
    }
  };

  const filteredDocs = documents.filter(d =>
    d.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
    d.category.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const totalChunks = documents.reduce((acc, d) => acc + d.chunkCount, 0);

  return (
    <div className="space-y-8 animate-fade-in max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Knowledge Base & Vector Store</h2>
          <p className="text-xs text-slate-500 mt-1">
            Manage reference documents and inspect the evidence sources available for response validation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Upload Reference Document</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Documents</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{documents.length}</div>
          <span className="text-[10px] text-slate-400">Trusted reference corpora</span>
        </div>

        <div className="bg-white rounded-xl border border-teal-200 p-4 shadow-xs">
          <span className="text-[11px] font-bold text-teal-800 uppercase tracking-wider flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" /> Indexed Chunks
          </span>
          <div className="text-2xl font-bold text-teal-900 mt-1">{totalChunks} chunks</div>
          <span className="text-[10px] text-teal-700">Stored in SQLite</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Pending Ingestion</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">0</div>
          <span className="text-[10px] text-slate-400">Queue is idle</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Vector Search</span>
          <div className="text-xs font-bold text-slate-800 mt-2 font-mono">FAISS / NumPy</div>
          <span className="text-[10px] text-slate-400">Exact inner-product search</span>
        </div>
      </div>

      {errorMessage && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          {errorMessage}
        </div>
      )}

      {/* Grounding Evidence Retrieval Testing Playground */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
              <Search className="w-4 h-4 text-teal-700" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Semantic Evidence Retrieval Test Playground</h3>
              <p className="text-[11px] text-slate-500">
                Test a query against the backend vector store and inspect returned passages
              </p>
            </div>
          </div>
          <span className="text-[10px] text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 font-medium">
          Backend vector search
          </span>
        </div>

        <form onSubmit={handleTestRetrieval} className="flex gap-3">
          <input
            type="text"
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            placeholder="Enter a test question or claim (e.g. 'What is the dosage of amoxicillin?' or 'RAG architecture benefits')..."
            className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 font-sans"
          />
          <button
            type="submit"
            disabled={isTestingRetrieval || !testQuery.trim()}
            className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            {isTestingRetrieval ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>Search knowledge base</span>
          </button>
        </form>

        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
          <span>
            <strong>Semantic Retrieval Disclaimer:</strong> Semantic similarity is a retrieval ranking signal and does not mathematically prove that a claim is true. The Accuracy Judge cross-examines the retrieved text against the claim logic.
          </span>
        </div>

        {/* Retrieval Results Preview */}
        {retrievalResults.length > 0 && (
          <div className="pt-3 space-y-3">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Top Retrieved Grounding Passages ({retrievalResults.length})
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {retrievalResults.map((chunk, idx) => (
                <div key={idx} className="p-3.5 rounded-xl border border-teal-200 bg-teal-50/20 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 truncate max-w-[200px] flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                      {chunk.documentName}
                    </span>
                    <span className="font-mono text-[11px] text-teal-800 bg-teal-100/70 px-2 py-0.5 rounded font-bold">
                      Sim: {(chunk.similarityScore * 100).toFixed(1)}%
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 bg-white p-2.5 rounded border border-teal-100 italic font-serif leading-relaxed">
                    "{chunk.content}"
                  </p>

                  <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>Chunk ID: {chunk.chunkId}</span>
                    <span>Tokens: {chunk.tokenCount}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Documents Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/50">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Indexed Document Corpus</h3>
            <p className="text-[11px] text-slate-500">Authoritative reference files stored in the evaluation knowledge base</p>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search documents by name or category..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 w-64"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Document Name</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Size</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Chunks</th>
                <th className="py-3 px-4">Vector Store Status</th>
                <th className="py-3 px-4">Upload Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDocs.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-brand-600 shrink-0" />
                      <span className="truncate max-w-xs">{doc.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 font-semibold">
                      {doc.fileType}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-500 text-[11px]">
                    {doc.fileSizeBytes === undefined ? '—' : `${(doc.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`}
                  </td>
                  <td className="py-3 px-4 text-slate-600">
                    {doc.category}
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-slate-800">
                    {doc.chunkCount}
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                      <CheckCircle2 className="w-3 h-3 text-teal-600" />
                      {doc.indexStatus}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-500 text-[11px]">
                    {doc.uploadDate.split(' ')[0]}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setSelectedDoc(doc)}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-brand-600 transition-colors cursor-pointer"
                        title="View chunks & vectors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleReindex(doc.id)}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-600 hover:text-teal-700 transition-colors cursor-pointer"
                        title="Re-embed document using the configured model"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteDoc(doc.id, doc.name)}
                        className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                        title="Delete document"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Document Modal */}
      <Modal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        title="Upload Grounding Reference Document"
        subtitle="Add reference text for chunking, embedding, and retrieval"
        maxWidth="lg"
      >
        <form onSubmit={handleUploadSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-700 font-bold mb-1">Document File Name</label>
            <input
              type="text"
              required
              value={uploadFileName}
              onChange={(e) => setUploadFileName(e.target.value)}
              placeholder="e.g. Infosys_Generative_AI_Handbook_2026.pdf"
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-bold mb-1">File Format</label>
              <select
                value={uploadFileType}
                onChange={(e) => setUploadFileType(e.target.value as 'PDF' | 'TXT' | 'DOCX' | 'MD' | 'JSON')}
                className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 cursor-pointer"
              >
                <option value="PDF">PDF Document</option>
                <option value="TXT">Plain Text (.txt)</option>
                <option value="DOCX" disabled>Microsoft Word (.docx) - not supported</option>
                <option value="MD">Markdown (.md)</option>
                <option value="JSON">Structured JSON (.json)</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-700 font-bold mb-1">Target Chunk Size</label>
              <select className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 cursor-pointer">
                <option>256 tokens (Dense retrieval)</option>
                <option>512 tokens (Standard)</option>
                <option>1024 tokens (Long context)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-slate-700 font-bold mb-1">Corpus ID</label>
            <input
              type="text"
              value={uploadCorpus}
              onChange={(e) => setUploadCorpus(e.target.value)}
              placeholder="demo"
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
            />
          </div>

          <div>
            <label className="block text-slate-700 font-bold mb-1">Choose a source file (optional)</label>
            <input
              type="file"
              accept=".pdf,.txt,.md,.json"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setUploadFile(file);
                if (file) setUploadFileName(file.name);
              }}
              className="w-full text-xs"
            />
          </div>

          <div>
            <label className="block text-slate-700 font-bold mb-1">
              Document text (required when no file is selected)
            </label>
            <textarea
              rows={4}
              value={uploadPreview}
              onChange={(e) => setUploadPreview(e.target.value)}
              placeholder="Paste sample paragraphs from the document for immediate chunk extraction..."
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-sans"
            />
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-brand-900">
            PDF, TXT, Markdown, and JSON files are ingested by the backend. DOCX is not supported.
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsUploadModalOpen(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span>Process & Index Document</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Document Chunks Inspector Modal */}
      <Modal
        isOpen={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        title={selectedDoc ? selectedDoc.name : ''}
        subtitle="Inspecting the indexed text chunks stored by the backend"
        maxWidth="2xl"
      >
        {selectedDoc && (
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
              <span>Category: <strong>{selectedDoc.category}</strong></span>
              <span>Total Chunks: <strong>{selectedDoc.chunkCount}</strong></span>
              <span>Status: <strong className="text-teal-700">{selectedDoc.indexStatus}</strong></span>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {selectedDoc.chunks && selectedDoc.chunks.length > 0 ? (
                selectedDoc.chunks.map((chunk) => (
                  <div key={chunk.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="font-mono font-bold text-slate-800">Chunk #{chunk.chunkIndex} ({chunk.id})</span>
                      <span className="text-slate-400">{chunk.tokenCount} words</span>
                    </div>
                    <p className="text-slate-800 bg-white p-2.5 rounded border border-slate-200 font-serif italic text-xs leading-relaxed">
                      "{chunk.content}"
                    </p>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-slate-400">
                  No individual chunks preview available for this document.
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedDoc(null)}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg font-semibold hover:bg-brand-700 cursor-pointer"
              >
                Close Chunk Inspector
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
