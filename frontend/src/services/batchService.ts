import { BatchJob, BatchItem } from '../types/batch';
import { apiClient } from './apiClient';

export const SAMPLE_CSV_TEMPLATE = `prompt,response,reference_answer
"Explain the architecture of Retrieval-Augmented Generation (RAG).","RAG references external knowledge bases prior to generation, combining retrieval with LLM inference.","RAG retrieves external document passages using vector search and augments the prompt."
"What is the maximum context length of Gemini 1.5 Pro?","Gemini 1.5 Pro supports up to 2 million tokens of multimodal context.","Gemini 1.5 Pro supports a 2M token context window."
"What is the capital of Australia and its official currency?","Sydney is the capital of Australia and uses the Australian Dollar.","Canberra is the capital of Australia, using AUD."
"How does Redis handle in-memory persistence?","Redis provides RDB point-in-time snapshots and AOF append-only logging for persistence.","Redis uses RDB snapshots and AOF transaction logs."`;

export interface CsvValidationResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: string[];
  parsedItems: Array<{
    rowNumber: number;
    question: string;
    response: string;
    referenceAnswer?: string;
    isValid: boolean;
    errorReason?: string;
  }>;
}

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  row.push(cell.trim());
  if (row.some(value => value.length > 0)) rows.push(row);
  return rows;
};

export const parseAndValidateCsv = (csvText: string): CsvValidationResult => {
  let rows: string[][];
  try {
    rows = parseCsv(csvText);
  } catch (error) {
    return {
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      errors: [error instanceof Error ? error.message : 'CSV could not be parsed.'],
      parsedItems: []
    };
  }
  if (rows.length <= 1) {
    return { totalRows: 0, validRows: 0, invalidRows: 0, errors: ['CSV file is empty or missing data rows.'], parsedItems: [] };
  }

  const headers = rows[0].map(header => header.toLowerCase().replace(/^\uFEFF/, '').trim());
  const qIndex = headers.indexOf('prompt') >= 0 ? headers.indexOf('prompt') : headers.indexOf('question');
  const rIndex = headers.indexOf('response');
  const refIndex = headers.indexOf('reference_answer') >= 0
    ? headers.indexOf('reference_answer')
    : headers.indexOf('reference answer');

  if (qIndex === -1 || rIndex === -1) {
    return {
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      errors: ['Missing required columns: CSV must contain "prompt" (or "question") and "response" headers.'],
      parsedItems: []
    };
  }

  const errors: string[] = [];
  const parsedItems: CsvValidationResult['parsedItems'] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const question = cells[qIndex] || '';
    const response = cells[rIndex] || '';
    const referenceAnswer = refIndex !== -1 ? cells[refIndex] : undefined;

    let isValid = true;
    let errorReason = '';

    if (!question.trim()) {
      isValid = false;
      errorReason = 'Missing question text';
    } else if (!response.trim()) {
      isValid = false;
      errorReason = 'Missing response text';
    }

    if (!isValid) {
      errors.push(`Row ${i + 1}: ${errorReason}`);
    }

    parsedItems.push({
      rowNumber: i,
      question,
      response,
      referenceAnswer,
      isValid,
      errorReason
    });
  }

  const validRows = parsedItems.filter(p => p.isValid).length;
  const invalidRows = parsedItems.length - validRows;

  return {
    totalRows: parsedItems.length,
    validRows,
    invalidRows,
    errors,
    parsedItems
  };
};

export const batchService = {
  createBatchJob: (name: string, model: string, items: CsvValidationResult['parsedItems']): BatchJob => {
    const batchItems: BatchItem[] = items.map((it, idx) => ({
      id: `BATCH-ITEM-${idx + 1}`,
      rowNumber: it.rowNumber,
      question: it.question,
      response: it.response,
      referenceAnswer: it.referenceAnswer,
      status: it.isValid ? 'pending' : 'failed',
      errorMessage: it.errorReason,
    }));

    const job: BatchJob = {
      id: `JOB-${Date.now().toString().slice(-6)}`,
      name: name || `Batch Evaluation ${new Date().toLocaleDateString()}`,
      uploadedAt: new Date().toISOString(),
      totalRows: batchItems.length,
      processedRows: 0,
      successfulCount: 0,
      failedCount: 0,
      status: 'queued',
      evaluatorModel: model,
      items: batchItems
    };

    return job;
  },

  runBatchEvaluation: async (
    job: BatchJob,
    file: File,
    onProgress: (updatedJob: BatchJob) => void
  ): Promise<BatchJob> => {
    job.status = 'running';
    onProgress({ ...job });
    const body = new FormData();
    body.append('file', file);
    const response = await apiClient.post<{
      processed: number;
      failed: number;
      results: Array<{
        row: number;
        id: string;
        verdict: BatchItem['verdict'];
        composite: number;
        scores: Record<string, number>;
      }>;
      errors: Array<{ row: number; error: string }>;
    }>('/api/batch/evaluate', body);
    const resultByRow = new Map(response.results.map(result => [result.row, result]));
    const errorByRow = new Map(response.errors.map(error => [error.row, error.error]));
    job.items = job.items.map(item => {
      const result = resultByRow.get(item.rowNumber);
      if (!result) {
        return {
          ...item,
          status: 'failed',
          errorMessage: errorByRow.get(item.rowNumber) || 'The server did not return a result for this row.',
        };
      }
      return {
        ...item,
        status: 'completed',
        overallScore: result.composite,
        relevanceScore: result.scores.relevance,
        accuracyScore: result.scores.accuracy,
        hallucinationScore: result.scores.hallucination,
        completenessScore: result.scores.completeness,
        verdict: result.verdict,
        evaluationId: result.id,
      };
    });
    job.processedRows = response.processed + response.failed;
    job.successfulCount = job.items.filter(item => item.verdict === 'Pass').length;
    job.failedCount = response.failed + job.items.filter(item => item.verdict !== undefined && item.verdict !== 'Pass').length;
    job.status = response.failed && !response.processed ? 'failed' : 'completed';
    onProgress({ ...job });
    return job;
  },

  exportBatchToCsv: (job: BatchJob): string => {
    const headers = ['Row', 'Question', 'Response', 'Overall Score', 'Relevance', 'Accuracy', 'Hallucination', 'Completeness', 'Verdict'];
    const rows = job.items.map(it => [
      it.rowNumber,
      `"${it.question.replace(/"/g, '""')}"`,
      `"${it.response.replace(/"/g, '""')}"`,
      it.overallScore ?? 'N/A',
      it.relevanceScore ?? 'N/A',
      it.accuracyScore ?? 'N/A',
      it.hallucinationScore ?? 'N/A',
      it.completenessScore ?? 'N/A',
      it.verdict ?? 'N/A'
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
};
