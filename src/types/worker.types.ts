export type AppMode = 'INFO' | 'LEARN';

export type WorkerRequestType = 
  | 'PING'
  | 'INIT_ENGINE'
  | 'GENERATE'
  | 'VECTORIZE_BUNDLE'
  | 'COSINE_SEARCH';

export interface ChatRequest {
  prompt: string;
  context?: string;
  mode: AppMode;
}

export interface KnowledgeBundle {
  chunks: string[];
}

export interface WorkerRequest {
  id: string; // Unique correlation UUID
  type: WorkerRequestType;
  payload?: any;
}

export interface WorkerResponse {
  id: string; // Unique correlation UUID
  type: WorkerRequestType;
  status: 'SUCCESS' | 'ERROR' | 'PROGRESS';
  payload?: any;
}
