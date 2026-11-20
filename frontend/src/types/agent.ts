export type AgentRole =
  | 'supervisor'
  | 'relevance_judge'
  | 'accuracy_judge'
  | 'hallucination_detector'
  | 'completeness_judge'
  | 'verdict_aggregator';

export interface AgentArchitectureNode {
  id: string;
  role: AgentRole;
  name: string;
  description: string;
  responsibilities: string[];
  promptTemplatePreview: string;
}
