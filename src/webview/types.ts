export interface FileAttachment {
  name: string;
  type: string;
  data?: string;
  sourceUri?: string;
  truncated?: boolean;
  originalSize?: number;
}

export interface Message {
  role: 'user' | 'ai' | 'error';
  text: string;
  files?: FileAttachment[];
  feedback?: 'like' | 'dislike' | null;
}

export interface McpServerUiState {
  name: string;
  enabled: boolean;
  editable: boolean;
  sourceKind: string;
  sourcePath?: string;
  transport: string;
  command?: string;
  args?: string[];
  url?: string;
  disabledReason?: string;
}

export interface McpServerListUiState {
  mcpEnabled: boolean;
  servers: McpServerUiState[];
}
