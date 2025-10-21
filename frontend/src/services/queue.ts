import { apiClient } from '../lib/api';

export interface JobTypeCounts {
  pending: number;
  active: number;
  completed: number;
}

export interface QueueStatusResponse {
  jobCounts: {
    [jobType: string]: JobTypeCounts;
  };
  totalPending: number;
}

export interface QueueStatus {
  indexIntent: JobTypeCounts;
  generateIntents: JobTypeCounts;
  semanticRelevancy: JobTypeCounts;
  totalPending: number;
}

function ensureJobTypeCounts(counts?: JobTypeCounts): JobTypeCounts {
  return {
    pending: counts?.pending || 0,
    active: counts?.active || 0,
    completed: counts?.completed || 0
  };
}

export const QueueService = {
  async getStatus(accessToken: string): Promise<QueueStatus> {
    const response = await apiClient.get<QueueStatusResponse>('/api/queue/status', accessToken);
    
    // Map job types to friendly names with safe defaults
    const indexIntent = ensureJobTypeCounts(response.jobCounts?.['index_intent']);
    const generateIntents = ensureJobTypeCounts(response.jobCounts?.['generate_intents']);
    const semanticRelevancy = ensureJobTypeCounts(response.jobCounts?.['broker_semantic_relevancy']);
    
    return {
      indexIntent,
      generateIntents,
      semanticRelevancy,
      totalPending: response.totalPending || 0
    };
  }
};

