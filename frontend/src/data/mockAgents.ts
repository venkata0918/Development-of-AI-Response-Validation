import { AgentArchitectureNode } from '../types/agent';

export const AGENT_NODES: AgentArchitectureNode[] = [
  {
    id: 'evaluation-pipeline',
    role: 'supervisor',
    name: 'Evaluation Pipeline',
    description: 'Coordinates evaluation stages and combines their results.',
    responsibilities: [
      'Runs the evaluation steps and assembles their structured outputs.',
      'Reports whether the result used the configured LLM or heuristic fallback.',
    ],
    promptTemplatePreview: 'Illustrative only: evaluate the response using configured judges, retrieved evidence, and conservative verdict rules.',
  },
  {
    id: 'relevance-judge',
    role: 'relevance_judge',
    name: 'Relevance Judge',
    description: 'Assesses how directly the response addresses the prompt.',
    responsibilities: [
      'Scores response relevance and returns a rationale.',
      'Uses an LLM when configured; otherwise uses the documented heuristic fallback.',
    ],
    promptTemplatePreview: 'Illustrative only: compare the prompt and response for direct relevance.',
  },
  {
    id: 'accuracy-judge',
    role: 'accuracy_judge',
    name: 'Accuracy Judge',
    description: 'Assesses extracted claims against available evidence.',
    responsibilities: [
      'Classifies claims based on retrieved reference passages.',
      'Distinguishes support, contradiction, unsupported claims, and insufficient evidence.',
    ],
    promptTemplatePreview: 'Illustrative only: compare each claim with retrieved evidence; retrieval similarity alone is not proof.',
  },
  {
    id: 'hallucination-judge',
    role: 'hallucination_detector',
    name: 'Hallucination Assessment',
    description: 'Derives the hallucination score from claim evidence classifications.',
    responsibilities: [
      'Keeps unsupported claims distinct from directly contradicted claims.',
      'Uses conservative evidence handling when retrieved context is insufficient.',
    ],
    promptTemplatePreview: 'Illustrative only: use claim classifications to derive the hallucination score.',
  },
  {
    id: 'completeness-judge',
    role: 'completeness_judge',
    name: 'Completeness Judge',
    description: 'Assesses response coverage of the prompt and any supplied reference answer.',
    responsibilities: [
      'Reports a completeness score and identified missing points.',
      'Uses an LLM when configured; otherwise uses the documented heuristic fallback.',
    ],
    promptTemplatePreview: 'Illustrative only: compare response coverage with the prompt and optional reference answer.',
  },
  {
    id: 'verdict-aggregator',
    role: 'verdict_aggregator',
    name: 'Verdict Aggregator',
    description: 'Combines judge results using the backend scoring policy and safety rules.',
    responsibilities: [
      'Applies the backend weights: relevance 20%, accuracy 30%, hallucination 25%, completeness 25%.',
      'Prevents Pass for contradictions, unsupported claims, or inconclusive claims.',
      'Applies the stricter Fail rule to medical or financial contradictions.',
    ],
    promptTemplatePreview: 'Deterministic backend aggregation; this is not an LLM prompt.',
  },
];
