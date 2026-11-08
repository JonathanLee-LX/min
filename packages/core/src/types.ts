/**
 * Provider-agnostic message and run types.
 * Vendor wire formats never enter the Runner — only adapters see them.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export interface TextPart {
  type: "text";
  text: string;
}

export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

/**
 * User image. Canonical / persisted messages store `blobId` only.
 * Adapters receive a copy with `data` filled in (hydrated).
 */
export interface ImagePart {
  type: "image";
  mediaType: ImageMediaType;
  blobId: string;
  filename?: string;
  /** Hydrated bytes for provider adapters. Never persist this field. */
  data?: Uint8Array;
}

/**
 * User PDF. Same persistence rule as {@link ImagePart}.
 */
export interface DocumentPart {
  type: "document";
  mediaType: "application/pdf";
  blobId: string;
  filename?: string;
  /** Hydrated bytes for provider adapters. Never persist this field. */
  data?: Uint8Array;
}

export interface ToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultPart {
  type: "tool_result";
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export type ContentPart =
  | TextPart
  | ImagePart
  | DocumentPart
  | ToolCallPart
  | ToolResultPart;

export interface Message {
  role: Role;
  content: ContentPart[];
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface CompletionRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  system?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CompletionResult {
  message: Message;
  stopReason: "end" | "tool_use" | "length" | "error";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface CompletionChunk {
  type: "text_delta" | "thinking_delta" | "tool_call_delta" | "done";
  text?: string;
  toolCall?: Partial<ToolCallPart>;
  result?: CompletionResult;
}

export type RunEvent =
  | { type: "turn_start"; turn: number }
  | { type: "text_delta"; text: string }
  /** Model reasoning / chain-of-thought stream (not persisted as ContentPart). */
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call"; toolCall: ToolCallPart }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean }
  | { type: "turn_end"; turn: number; message: Message }
  | { type: "done"; messages: Message[] }
  | { type: "error"; error: Error };

export interface RunInput {
  /** User prompt text, or a full message list to continue from. */
  input: string | Message[];
  signal?: AbortSignal;
  maxTurns?: number;
  onEvent?: (event: RunEvent) => void | Promise<void>;
}

export interface RunResult {
  messages: Message[];
  text: string;
  turns: number;
}
