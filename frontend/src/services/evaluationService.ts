import { apiClient } from './apiClient';
import { EvaluationResult, EvaluationFilter, OverallVerdict, ClaimStatus } from '../types/evaluation';

interface ApiEvidence {
  text: string;
  source?: string;
  doc?: string;
  similarity?: number;
  chunk_id?: number;
}

interface ApiClaim {
  id: string;
  text: string;
  label: ClaimStatus;
  reason?: string;
  evidence: ApiEvidence[];
  mode: string;
}

interface ApiEvaluation {
  id: string;
  created_at: string;
  prompt: string;
  response: string;
  corpus?: string | null;
  verdict: OverallVerdict;
  verdict_reason: string;
  composite: number;
  scores: Record<string, number>;
  reasons: Record<string, string>;
  modes: Record<string, string>;
  claims: ApiClaim[];
  missing: string[];
  warnings: string[];
  safety_veto: boolean;
  trace: Array<{ agent: string; summary: string; mode: string; ms: number }>;
}

interface ApiEvaluationList {
  total: number;
  items: Array<ApiEvaluation | { data: ApiEvaluation }>;
}

export interface EvaluationSubmission {
  question: string;
  response: string;
  referenceAnswer?: string;
  referenceDocumentName?: string;
  evaluatorModel?: string;
  strictness?: 'lenient' | 'standard' | 'strict';
  topK?: number;
}

export type PipelineStage =
  | 'input_validation'
  | 'claim_extraction'
  | 'evidence_retrieval'
  | 'relevance_evaluation'
  | 'accuracy_evaluation'
  | 'hallucination_assessment'
  | 'completeness_evaluation'
  | 'verdict_aggregation'
  | 'results_generation';

export interface StageProgress {
  stage: PipelineStage;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detail?: string;
}

const stages: Array<{ stage: PipelineStage; label: string; agent: string }> = [
  { stage: 'input_validation', label: 'Validating evaluation input', agent: '' },
  { stage: 'claim_extraction', label: 'Extracting and verifying factual claims', agent: 'Claim Verifier' },
  { stage: 'evidence_retrieval', label: 'Retrieving reference evidence', agent: 'Retriever' },
  { stage: 'relevance_evaluation', label: 'Evaluating relevance', agent: 'Relevance Judge' },
  { stage: 'accuracy_evaluation', label: 'Evaluating accuracy', agent: 'Accuracy Judge' },
  { stage: 'hallucination_assessment', label: 'Assessing hallucinations', agent: 'Hallucination Sentinel' },
  { stage: 'completeness_evaluation', label: 'Evaluating completeness', agent: 'Completeness Judge' },
  { stage: 'verdict_aggregation', label: 'Aggregating verdict', agent: 'Verdict Aggregator' },
  { stage: 'results_generation', label: 'Saving evaluation result', agent: '' },
];

const dimension = (
  key: string,
  name: 'Relevance' | 'Accuracy' | 'Hallucination Assessment' | 'Completeness',
  score: number,
  reason: string
) => ({
  name,
  score,
  normalizedScore: Math.round(score * 20),
  weight: ({ relevance: 0.2, accuracy: 0.3, hallucination: 0.25, completeness: 0.25 } as const)[key as 'relevance' | 'accuracy' | 'hallucination' | 'completeness'],
  status: score >= 4 ? 'optimal' as const : score >= 3 ? 'acceptable' as const : score > 0 ? 'concerning' as const : 'critical' as const,
  explanation: reason,
  keyObservation: reason,
});

const toEvaluationResult = (data: ApiEvaluation): EvaluationResult => {
  const claims = data.claims.map((claim, index) => {
    const evidence = claim.evidence[0];
    return {
      id: claim.id,
      claimNumber: index + 1,
      claimText: claim.text,
      status: claim.label,
      confidence: 0,
      explanation: claim.reason || (claim.label === 'supported'
        ? 'The claim is supported by the matching retrieved passage.'
        : claim.label === 'contradicted'
          ? 'The claim conflicts with the matching retrieved passage.'
          : claim.label === 'unsupported'
            ? 'Relevant evidence was retrieved, but it does not establish this claim.'
            : 'No sufficiently relevant evidence was available to decide this claim.'),
      evidenceQuote: evidence?.text,
      sourceDocument: evidence?.source || evidence?.doc,
      chunkId: evidence?.chunk_id === undefined ? undefined : String(evidence.chunk_id),
      similarityScore: evidence?.similarity,
    };
  });
  const scores = data.scores;
  const reasons = data.reasons;
  const supported = claims.filter(claim => claim.status === 'supported').length;
  const unsupported = claims.filter(claim => claim.status === 'unsupported' || claim.status === 'contradicted');
  const trace = data.trace || [];
  const rationales = Object.fromEntries(trace.map(item => [item.agent, item.summary]));

  return {
    id: data.id,
    question: data.prompt,
    response: data.response,
    referenceDocumentName: data.corpus || 'No corpus selected',
    timestamp: data.created_at,
    evaluatorModel: Object.values(data.modes || {}).some(mode => mode === 'llm')
      ? 'Anthropic Claude (LLM-enabled)'
      : 'Heuristic fallback',
    evaluatorStrictness: 'standard',
    overallScore: data.composite,
    verdict: data.verdict,
    confidenceScore: claims.length ? Math.round((supported / claims.length) * 100) : 0,
    verdictSummary: data.verdict_reason,
    strengths: claims.filter(claim => claim.status === 'supported').map(claim => claim.claimText),
    identifiedIssues: unsupported.map(claim => claim.claimText),
    unsupportedClaimsSummary: unsupported.map(claim => claim.claimText),
    missingInformation: data.missing || [],
    recommendations: data.warnings?.length ? data.warnings : [],
    uncertaintyWarnings: data.warnings || [],
    dimensions: {
      relevance: dimension('relevance', 'Relevance', scores.relevance, reasons.relevance),
      accuracy: dimension('accuracy', 'Accuracy', scores.accuracy, reasons.accuracy),
      hallucination: dimension('hallucination', 'Hallucination Assessment', scores.hallucination, reasons.hallucination),
      completeness: dimension('completeness', 'Completeness', scores.completeness, reasons.completeness),
    },
    claims,
    agentRationales: {
      supervisor: rationales['Claim Verifier'] || 'Evaluation steps are listed in the execution trace.',
      relevanceJudge: reasons.relevance,
      accuracyJudge: reasons.accuracy,
      hallucinationDetector: reasons.hallucination,
      completenessJudge: reasons.completeness,
      verdictAggregator: data.verdict_reason,
    },
    latencyMs: trace.reduce((total, item) => total + item.ms, 0),
    tokenCount: 0,
    isDemoData: false,
    executionTrace: trace,
  };
};

const getApiResult = (item: ApiEvaluation | { data: ApiEvaluation }): ApiEvaluation =>
  'data' in item ? item.data : item;

const strictnessValue = (strictness: EvaluationSubmission['strictness']): number =>
  strictness === 'strict' ? 1 : strictness === 'lenient' ? 0 : 0.5;

export const evaluationService = {
  getAll: async (filter?: EvaluationFilter): Promise<EvaluationResult[]> => {
    const params = new URLSearchParams({ limit: '200', offset: '0' });
    if (filter?.searchQuery?.trim()) params.set('q', filter.searchQuery.trim());
    if (filter?.verdict && filter.verdict !== 'all') params.set('verdict', filter.verdict);
    const all: EvaluationResult[] = [];
    let total = 0;
    do {
      params.set('offset', String(all.length));
      const page = await apiClient.get<ApiEvaluationList>(`/api/evaluations?${params.toString()}`);
      total = page.total;
      all.push(...page.items.map(item => toEvaluationResult(getApiResult(item))));
    } while (all.length < total);
    let records = all;

    if (filter?.scoreRange && filter.scoreRange !== 'all') {
      records = records.filter(record => {
        if (filter.scoreRange === '90-100') return record.overallScore >= 90;
        if (filter.scoreRange === '75-89') return record.overallScore >= 75 && record.overallScore < 90;
        if (filter.scoreRange === '60-74') return record.overallScore >= 60 && record.overallScore < 75;
        return record.overallScore < 60;
      });
    }
    if (filter?.hallucinationStatus && filter.hallucinationStatus !== 'all') {
      records = records.filter(record => {
        const contradicted = record.claims.some(claim => claim.status === 'contradicted');
        const unsupported = record.claims.some(claim => claim.status === 'unsupported');
        if (filter.hallucinationStatus === 'clean') return !contradicted && !unsupported;
        if (filter.hallucinationStatus === 'contradicted') return contradicted;
        if (filter.hallucinationStatus === 'unsupported') return unsupported;
        return true;
      });
    }
    return records;
  },

  getById: async (id: string): Promise<EvaluationResult | null> => {
    try {
      return toEvaluationResult(await apiClient.get<ApiEvaluation>(`/api/evaluations/${encodeURIComponent(id)}`));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('HTTP 404:')) return null;
      throw error;
    }
  },

  submitEvaluation: async (
    payload: EvaluationSubmission,
    onProgress?: (stage: StageProgress) => void
  ): Promise<EvaluationResult> => {
    onProgress?.({ stage: 'input_validation', label: 'Submitting evaluation to backend', status: 'running' });
    const data = await apiClient.post<ApiEvaluation>('/api/evaluate', {
      prompt: payload.question,
      response: payload.response,
      corpus: payload.referenceDocumentName || 'demo',
      reference_answer: payload.referenceAnswer || null,
      strictness: strictnessValue(payload.strictness),
      top_k: payload.topK || 4,
    });
    const traceByAgent = new Map(data.trace.map(item => [item.agent, item]));
    for (const step of stages) {
      const trace = traceByAgent.get(step.agent);
      onProgress?.({
        stage: step.stage,
        label: step.label,
        status: 'completed',
        detail: trace ? `${trace.summary} (${trace.mode})` : 'Completed by backend',
      });
    }
    return toEvaluationResult(data);
  },

  deleteEvaluation: async (id: string): Promise<boolean> => {
    await apiClient.delete(`/api/evaluations/${encodeURIComponent(id)}`);
    return true;
  },
};
