/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// DISCLAIMER: This is a copied version of https://github.com/googleapis/js-genai/blob/main/src/chats.ts with the intention of working around a key bug
// where function responses are not treated as "valid" responses: https://b.corp.google.com/issues/420354090

import {
  GenerateContentResponse,
  Content,
  GenerateContentConfig,
  SendMessageParameters,
  createUserContent,
  Part,
  GenerateContentResponseUsageMetadata,
  Tool,
} from '@google/genai';
import { retryWithBackoff } from '../utils/retry.js';
import { isFunctionResponse } from '../utils/messageInspectors.js';
import { ContentGenerator, AuthType } from './contentGenerator.js';
import { Config } from '../config/config.js';
import {
  logApiRequest,
  logApiResponse,
  logApiError,
} from '../telemetry/loggers.js';
import {
  ApiErrorEvent,
  ApiRequestEvent,
  ApiResponseEvent,
} from '../telemetry/types.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import * as crypto from 'crypto';

/**
 * Returns true if the response is valid, false otherwise.
 */
function isValidResponse(response: GenerateContentResponse): boolean {
  if (response.candidates === undefined || response.candidates.length === 0) {
    return false;
  }
  const content = response.candidates[0]?.content;
  if (content === undefined) {
    return false;
  }
  return isValidContent(content);
}

function isValidContent(content: Content): boolean {
  if (content.parts === undefined || content.parts.length === 0) {
    return false;
  }
  for (const part of content.parts) {
    if (part === undefined || Object.keys(part).length === 0) {
      return false;
    }
    if (!part.thought && part.text !== undefined && part.text === '') {
      return false;
    }
  }
  return true;
}

/**
 * Validates the history contains the correct roles.
 *
 * @throws Error if the history does not start with a user turn.
 * @throws Error if the history contains an invalid role.
 */
function validateHistory(history: Content[]) {
  for (const content of history) {
    if (content.role !== 'user' && content.role !== 'model') {
      throw new Error(`Role must be user or model, but got ${content.role}.`);
    }
  }
}

/**
 * Extracts the curated (valid) history from a comprehensive history.
 *
 * @remarks
 * The model may sometimes generate invalid or empty contents(e.g., due to safety
 * filters or recitation). Extracting valid turns from the history
 * ensures that subsequent requests could be accepted by the model.
 */
function extractCuratedHistory(comprehensiveHistory: Content[]): Content[] {
  if (comprehensiveHistory === undefined || comprehensiveHistory.length === 0) {
    return [];
  }
  const curatedHistory: Content[] = [];
  const length = comprehensiveHistory.length;
  let i = 0;
  while (i < length) {
    if (comprehensiveHistory[i].role === 'user') {
      curatedHistory.push(comprehensiveHistory[i]);
      i++;
    } else {
      const modelOutput: Content[] = [];
      let isValid = true;
      while (i < length && comprehensiveHistory[i].role === 'model') {
        modelOutput.push(comprehensiveHistory[i]);
        if (isValid && !isValidContent(comprehensiveHistory[i])) {
          isValid = false;
        }
        i++;
      }
      if (isValid) {
        curatedHistory.push(...modelOutput);
      } else {
        // Remove the last user input when model content is invalid.
        curatedHistory.pop();
      }
    }
  }
  return curatedHistory;
}

/**
 * Chat session that enables sending messages to the model with previous
 * conversation context.
 *
 * @remarks
 * The session maintains all the turns between user and model.
 */
export class GeminiChat {
  // A promise to represent the current state of the message being sent to the
  // model.
  private sendPromise: Promise<void> = Promise.resolve();
  
  // Track logged responses to prevent duplicates
  private loggedResponses: Set<string> = new Set();

  constructor(
    private readonly config: Config,
    private readonly contentGenerator: ContentGenerator,
    private readonly generationConfig: GenerateContentConfig = {},
    private history: Content[] = [],
  ) {
    validateHistory(history);
  }

  private _getRequestTextFromContents(contents: Content[]): string {
    return JSON.stringify(contents);
  }

  // Helper method to detect operation type
  private _detectOperationType(
    contents: Content[],
  ): 'chat' | 'tool_call' | 'completion' | 'embedding' | 'unknown' {
    // Check if any content has function calls
    for (const content of contents) {
      if (content.role === 'model' && content.parts) {
        for (const part of content.parts) {
          if (part.functionCall) {
            return 'tool_call';
          }
        }
      }
    }

    // If we have a conversation history, it's likely a chat
    if (contents.length > 1) {
      return 'chat';
    }

    // For single turn, we'll default to chat for now
    // In the future, we could analyze the content to determine if it's a completion or embedding request
    if (contents.length === 1) {
      return 'chat';
    }

    return 'unknown';
  }

  // Helper method to extract tools that might be called based on request content
  private _extractToolsCalled(contents: Content[]): string[] {
    // For API requests, we want to detect what specific tools might be called
    // by analyzing the user's LATEST request content, not the entire conversation history
    
    const potentialTools: string[] = [];
    
    // Find the most recent user message (last user content in the array)
    const latestUserContent = contents.slice().reverse().find(content => content.role === 'user');
    console.log('DEBUG: latestUserContent:', JSON.stringify(latestUserContent, null, 2));
    
    if (latestUserContent && latestUserContent.parts) {
      for (const part of latestUserContent.parts) {
        if (part.text) {
          const text = part.text.toLowerCase();
          
          // Look for common patterns that indicate specific tools
          if (text.includes('@') || text.includes('read') || text.includes('file')) {
            potentialTools.push('read_file');
          }
          if (text.includes('write') || text.includes('create') || text.includes('save')) {
            potentialTools.push('write_file');
          }
          if (text.includes('edit') || text.includes('modify') || text.includes('change')) {
            potentialTools.push('replace');
          }
          if (text.includes('search') || text.includes('find') || text.includes('grep')) {
            potentialTools.push('search_file_content');
          }
          if (text.includes('list') || text.includes('ls') || text.includes('directory')) {
            potentialTools.push('list_directory');
          }
          if (text.includes('run') || text.includes('execute') || text.includes('bash') || text.includes('command')) {
            potentialTools.push('run_shell_command');
          }
          if (text.includes('web') || text.includes('http') || text.includes('url')) {
            potentialTools.push('web_fetch');
          }
        }
      }
    }
    
    // Return empty array for pure chat requests, specific tools for likely tool requests
    const result = [...new Set(potentialTools)];
    console.log('DEBUG: _extractToolsCalled result:', result);
    return result;
  }

  // Helper method to determine request context
  private _determineRequestContext(
    contents: Content[],
  ): 'new' | 'continuation' | 'tool_result' {
    if (contents.length === 0) {
      return 'new';
    }

    // Check if the last content is a function response (tool result)
    const lastContent = contents[contents.length - 1];
    if (lastContent.role === 'user') {
      const hasFunctionResponse = lastContent.parts?.some(
        (part) => part.functionResponse,
      );
      if (hasFunctionResponse) {
        return 'tool_result';
      }
    }

    // If we have more than one content, it's a continuation
    if (contents.length > 1) {
      return 'continuation';
    }

    // Otherwise, it's a new request
    return 'new';
  }

  // Helper method to estimate tokens (simplified)
  private _estimateTokens(contents: Content[]): number {
    let tokenCount = 0;

    for (const content of contents) {
      if (content.parts) {
        for (const part of content.parts) {
          if (part.text) {
            // Rough estimation: 1 token per 4 characters
            tokenCount += Math.ceil(part.text.length / 4);
          }
        }
      }
    }

    return tokenCount;
  }

  // Helper method to check for file context
  private _hasFileContext(contents: Content[]): boolean {
    for (const content of contents) {
      if (content.parts) {
        for (const part of content.parts) {
          // Check for file-related content
          if (
            part.text &&
            (part.text.includes('file:') ||
              part.text.includes('.txt') ||
              part.text.includes('.js') ||
              part.text.includes('.ts') ||
              part.text.includes('.py') ||
              part.text.includes('.json'))
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // Helper method to get system prompt length
  private _getSystemPromptLength(contents: Content[], config?: any): number {
    if (!config?.systemInstruction) {
      return 0;
    }

    const systemInstruction = config.systemInstruction;
    let systemText = '';

    if (typeof systemInstruction === 'string') {
      systemText = systemInstruction;
    } else if (typeof systemInstruction === 'object' && 'parts' in systemInstruction) {
      // Handle Content object with parts
      systemText = systemInstruction.parts
        ?.map((part: any) => part.text || '')
        .join('')
        || '';
    } else if (typeof systemInstruction === 'object' && 'text' in systemInstruction) {
      // Handle simple text object
      systemText = systemInstruction.text || '';
    }

    return systemText.length;
  }

  private async _logApiRequest(
    contents: Content[],
    model: string,
    prompt_id: string,
  ): Promise<string> {
    const requestText = this._getRequestTextFromContents(contents);

    // Generate unique request ID
    const requestId = crypto.randomUUID();

    // Collect enhanced data
    const operationType = this._detectOperationType(contents);
    const toolsCalled = this._extractToolsCalled(contents);
    const requestContext = this._determineRequestContext(contents);
    const estimatedTokens = this._estimateTokens(contents);
    const conversationTurn = Math.ceil(contents.length / 2); // Rough estimate
    const hasFileContext = this._hasFileContext(contents);
    const systemPromptLength = this._getSystemPromptLength(contents, this.generationConfig);

    logApiRequest(
      this.config,
      new ApiRequestEvent(
        model,
        prompt_id,
        requestId,
        requestText,
        operationType,
        toolsCalled,
        requestContext,
        estimatedTokens,
        conversationTurn,
        hasFileContext,
        systemPromptLength,
      ),
    );

    return requestId;
  }

  // Helper method to detect response type
  private _detectResponseType(
    response: unknown,
  ): 'tool_call' | 'text_response' | 'mixed' | 'error' | 'streaming_chunk' {
    if (!response) {
      return 'error';
    }

    // Type guard for response object
    if (typeof response !== 'object' || response === null) {
      return 'error';
    }

    // Check for candidates array
    const candidates = (response as any).candidates;
    if (!Array.isArray(candidates)) {
      // Check if it's a streaming chunk
      if ((response as any).isChunk) {
        return 'streaming_chunk';
      }
      return 'error';
    }

    // Check for tool calls
    const hasToolCalls = candidates.some((candidate) =>
      candidate.content?.parts?.some((part: any) => part.functionCall),
    );

    // Check for text content
    const hasText = candidates.some((candidate) =>
      candidate.content?.parts?.some((part: any) => part.text),
    );

    if (hasToolCalls && hasText) {
      return 'mixed';
    } else if (hasToolCalls) {
      return 'tool_call';
    } else if (hasText) {
      return 'text_response';
    }

    return 'error';
  }

  private async _logApiResponse(
    durationMs: number,
    prompt_id: string,
    requestId: string,
    usageMetadata?: GenerateContentResponseUsageMetadata,
    responseText?: string,
  ): Promise<void> {
    // Only log responses that have usageMetadata (successful responses)
    // Skip logging streaming artifacts or error responses without usage data
    if (!usageMetadata) {
      return; // Don't log responses without usage metadata
    }

    // DEBUG: Temporarily disable duplicate prevention
    console.log('DEBUG: _logApiResponse called with usageMetadata:', !!usageMetadata, 'requestId:', requestId);
    
    // With requestId-based logging, we use requestId instead of prompt_id for duplicate prevention
    // if (this.loggedResponses.has(requestId)) {
    //   return; // Already logged this response
    // }
    // 
    // // Mark this response as logged immediately to prevent race conditions
    // this.loggedResponses.add(requestId);
    
    // Clean up old entries to prevent memory leaks (keep only last 100)
    if (this.loggedResponses.size > 100) {
      const entries = Array.from(this.loggedResponses);
      entries.slice(0, 50).forEach(id => this.loggedResponses.delete(id));
    }
    
    // Parse response text to get structured data
    let response: unknown = null;
    if (responseText) {
      try {
        response = JSON.parse(responseText);
      } catch (e) {
        // If parsing fails, we'll work with the raw text
        // This is expected for streaming responses
      }
    }

    // Collect enhanced data - only set responseType if we have usageMetadata (successful response)
    const responseType = this._detectResponseType(response);

    logApiResponse(
      this.config,
      new ApiResponseEvent(
        this.config.getModel(),
        durationMs,
        prompt_id,
        requestId,
        this.config.getContentGeneratorConfig()?.authType,
        usageMetadata,
        responseText,
        undefined, // error
        responseType,
      ),
    );
  }

  private _logApiError(
    durationMs: number,
    error: unknown,
    prompt_id: string,
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.name : 'unknown';

    logApiError(
      this.config,
      new ApiErrorEvent(
        this.config.getModel(),
        errorMessage,
        durationMs,
        prompt_id,
        this.config.getContentGeneratorConfig()?.authType,
        errorType,
      ),
    );
  }

  /**
   * Handles falling back to Flash model when persistent 429 errors occur for OAuth users.
   * Uses a fallback handler if provided by the config; otherwise, returns null.
   */
  private async handleFlashFallback(
    authType?: string,
    error?: unknown,
  ): Promise<string | null> {
    // Handle different auth types
    if (authType === AuthType.QWEN_OAUTH) {
      return this.handleQwenOAuthError(error);
    }

    // Only handle fallback for OAuth users
    if (authType !== AuthType.LOGIN_WITH_GOOGLE) {
      return null;
    }

    const currentModel = this.config.getModel();
    const fallbackModel = DEFAULT_GEMINI_FLASH_MODEL;

    // Don't fallback if already using Flash model
    if (currentModel === fallbackModel) {
      return null;
    }

    // Check if config has a fallback handler (set by CLI package)
    const fallbackHandler = this.config.flashFallbackHandler;
    if (typeof fallbackHandler === 'function') {
      try {
        const accepted = await fallbackHandler(
          currentModel,
          fallbackModel,
          error,
        );
        if (accepted !== false && accepted !== null) {
          this.config.setModel(fallbackModel);
          this.config.setFallbackMode(true);
          return fallbackModel;
        }
        // Check if the model was switched manually in the handler
        if (this.config.getModel() === fallbackModel) {
          return null; // Model was switched but don't continue with current prompt
        }
      } catch (error) {
        console.warn('Flash fallback handler failed:', error);
      }
    }

    return null;
  }

  /**
   * Sends a message to the model and returns the response.
   *
   * @remarks
   * This method will wait for the previous message to be processed before
   * sending the next message.
   *
   * @see {@link Chat#sendMessageStream} for streaming method.
   * @param params - parameters for sending messages within a chat session.
   * @returns The model's response.
   *
   * @example
   * ```ts
   * const chat = ai.chats.create({model: 'gemini-2.0-flash'});
   * const response = await chat.sendMessage({
   *   message: 'Why is the sky blue?'
   * });
   * console.log(response.text);
   * ```
   */
  async sendMessage(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<GenerateContentResponse> {
    await this.sendPromise;
    const userContent = createUserContent(params.message);
    const requestContents = this.getHistory(true).concat(userContent);

    const requestId = await this._logApiRequest(requestContents, this.config.getModel(), prompt_id);

    const startTime = Date.now();
    let response: GenerateContentResponse;

    try {
      const apiCall = () => {
        const modelToUse = this.config.getModel() || DEFAULT_GEMINI_FLASH_MODEL;

        // Prevent Flash model calls immediately after quota error
        if (
          this.config.getQuotaErrorOccurred() &&
          modelToUse === DEFAULT_GEMINI_FLASH_MODEL
        ) {
          throw new Error(
            'Please submit a new query to continue with the Flash model.',
          );
        }

        return this.contentGenerator.generateContent(
          {
            model: modelToUse,
            contents: requestContents,
            config: { ...this.generationConfig, ...params.config },
          },
          prompt_id,
          requestId,
        );
      };

      response = await retryWithBackoff(apiCall, {
        shouldRetry: (error: Error) => {
          if (error && error.message) {
            if (error.message.includes('429')) return true;
            if (error.message.match(/5\d{2}/)) return true;
          }
          return false;
        },
        onPersistent429: async (authType?: string, error?: unknown) =>
          await this.handleFlashFallback(authType, error),
        authType: this.config.getContentGeneratorConfig()?.authType,
      });
      const durationMs = Date.now() - startTime;
      await this._logApiResponse(
        durationMs,
        prompt_id,
        requestId,
        response.usageMetadata,
        JSON.stringify(response),
      );

      this.sendPromise = (async () => {
        const outputContent = response.candidates?.[0]?.content;
        // Because the AFC input contains the entire curated chat history in
        // addition to the new user input, we need to truncate the AFC history
        // to deduplicate the existing chat history.
        const fullAutomaticFunctionCallingHistory =
          response.automaticFunctionCallingHistory;
        const index = this.getHistory(true).length;
        let automaticFunctionCallingHistory: Content[] = [];
        if (fullAutomaticFunctionCallingHistory != null) {
          automaticFunctionCallingHistory =
            fullAutomaticFunctionCallingHistory.slice(index) ?? [];
        }
        const modelOutput = outputContent ? [outputContent] : [];
        this.recordHistory(
          userContent,
          modelOutput,
          automaticFunctionCallingHistory,
        );
      })();
      await this.sendPromise.catch(() => {
        // Resets sendPromise to avoid subsequent calls failing
        this.sendPromise = Promise.resolve();
      });
      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this._logApiError(durationMs, error, prompt_id);
      this.sendPromise = Promise.resolve();
      throw error;
    }
  }

  /**
   * Sends a message to the model and returns the response in chunks.
   *
   * @remarks
   * This method will wait for the previous message to be processed before
   * sending the next message.
   *
   * @see {@link Chat#sendMessage} for non-streaming method.
   * @param params - parameters for sending the message.
   * @return The model's response.
   *
   * @example
   * ```ts
   * const chat = ai.chats.create({model: 'gemini-2.0-flash'});
   * const response = await chat.sendMessageStream({
   *   message: 'Why is the sky blue?'
   * });
   * for await (const chunk of response) {
   *   console.log(chunk.text);
   * }
   * ```
   */
  async sendMessageStream(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    await this.sendPromise;
    const userContent = createUserContent(params.message);
    const requestContents = this.getHistory(true).concat(userContent);
    const requestId = await this._logApiRequest(requestContents, this.config.getModel(), prompt_id);

    const startTime = Date.now();

    try {
      const apiCall = () => {
        const modelToUse = this.config.getModel();

        // Prevent Flash model calls immediately after quota error
        if (
          this.config.getQuotaErrorOccurred() &&
          modelToUse === DEFAULT_GEMINI_FLASH_MODEL
        ) {
          throw new Error(
            'Please submit a new query to continue with the Flash model.',
          );
        }

        return this.contentGenerator.generateContentStream(
          {
            model: modelToUse,
            contents: requestContents,
            config: { ...this.generationConfig, ...params.config },
          },
          prompt_id,
          requestId,
        );
      };

      // Note: Retrying streams can be complex. If generateContentStream itself doesn't handle retries
      // for transient issues internally before yielding the async generator, this retry will re-initiate
      // the stream. For simple 429/500 errors on initial call, this is fine.
      // If errors occur mid-stream, this setup won't resume the stream; it will restart it.
      const streamResponse = await retryWithBackoff(apiCall, {
        shouldRetry: (error: Error) => {
          // Check error messages for status codes, or specific error names if known
          if (error && error.message) {
            if (error.message.includes('429')) return true;
            if (error.message.match(/5\d{2}/)) return true;
          }
          return false; // Don't retry other errors by default
        },
        onPersistent429: async (authType?: string, error?: unknown) =>
          await this.handleFlashFallback(authType, error),
        authType: this.config.getContentGeneratorConfig()?.authType,
      });

      // Resolve the internal tracking of send completion promise - `sendPromise`
      // for both success and failure response. The actual failure is still
      // propagated by the `await streamResponse`.
      this.sendPromise = Promise.resolve(streamResponse)
        .then(() => undefined)
        .catch(() => undefined);

      const result = this.processStreamResponse(
        streamResponse,
        userContent,
        startTime,
        prompt_id,
        requestId,
      );
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this._logApiError(durationMs, error, prompt_id);
      this.sendPromise = Promise.resolve();
      throw error;
    }
  }

  /**
   * Returns the chat history.
   *
   * @remarks
   * The history is a list of contents alternating between user and model.
   *
   * There are two types of history:
   * - The `curated history` contains only the valid turns between user and
   * model, which will be included in the subsequent requests sent to the model.
   * - The `comprehensive history` contains all turns, including invalid or
   *   empty model outputs, providing a complete record of the history.
   *
   * The history is updated after receiving the response from the model,
   * for streaming response, it means receiving the last chunk of the response.
   *
   * The `comprehensive history` is returned by default. To get the `curated
   * history`, set the `curated` parameter to `true`.
   *
   * @param curated - whether to return the curated history or the comprehensive
   *     history.
   * @return History contents alternating between user and model for the entire
   *     chat session.
   */
  getHistory(curated: boolean = false): Content[] {
    const history = curated
      ? extractCuratedHistory(this.history)
      : this.history;
    // Deep copy the history to avoid mutating the history outside of the
    // chat session.
    return structuredClone(history);
  }

  /**
   * Clears the chat history.
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Adds a new entry to the chat history.
   *
   * @param content - The content to add to the history.
   */
  addHistory(content: Content): void {
    this.history.push(content);
  }
  setHistory(history: Content[]): void {
    this.history = history;
  }

  setTools(tools: Tool[]): void {
    this.generationConfig.tools = tools;
  }

  getFinalUsageMetadata(
    chunks: GenerateContentResponse[],
  ): GenerateContentResponseUsageMetadata | undefined {
    const lastChunkWithMetadata = chunks
      .slice()
      .reverse()
      .find((chunk) => chunk.usageMetadata);

    return lastChunkWithMetadata?.usageMetadata;
  }

  private async *processStreamResponse(
    streamResponse: AsyncGenerator<GenerateContentResponse>,
    inputContent: Content,
    startTime: number,
    prompt_id: string,
    requestId: string,
  ) {
    const outputContent: Content[] = [];
    const chunks: GenerateContentResponse[] = [];
    let errorOccurred = false;

    try {
      for await (const chunk of streamResponse) {
        if (isValidResponse(chunk)) {
          chunks.push(chunk);
          const content = chunk.candidates?.[0]?.content;
          if (content !== undefined) {
            if (this.isThoughtContent(content)) {
              yield chunk;
              continue;
            }
            outputContent.push(content);
          }
        }
        yield chunk;
      }
    } catch (error) {
      errorOccurred = true;
      const durationMs = Date.now() - startTime;
      this._logApiError(durationMs, error, prompt_id);
      throw error;
    }

    if (!errorOccurred) {
      const durationMs = Date.now() - startTime;
      const allParts: Part[] = [];
      for (const content of outputContent) {
        if (content.parts) {
          allParts.push(...content.parts);
        }
      }
      await this._logApiResponse(
        durationMs,
        prompt_id,
        requestId,
        this.getFinalUsageMetadata(chunks),
        JSON.stringify(chunks),
      );
    }
    this.recordHistory(inputContent, outputContent);
  }

  private recordHistory(
    userInput: Content,
    modelOutput: Content[],
    automaticFunctionCallingHistory?: Content[],
  ) {
    const nonThoughtModelOutput = modelOutput.filter(
      (content) => !this.isThoughtContent(content),
    );

    let outputContents: Content[] = [];
    if (
      nonThoughtModelOutput.length > 0 &&
      nonThoughtModelOutput.every((content) => content.role !== undefined)
    ) {
      outputContents = nonThoughtModelOutput;
    } else if (nonThoughtModelOutput.length === 0 && modelOutput.length > 0) {
      // This case handles when the model returns only a thought.
      // We don't want to add an empty model response in this case.
    } else {
      // When not a function response appends an empty content when model returns empty response, so that the
      // history is always alternating between user and model.
      // Workaround for: https://b.corp.google.com/issues/420354090
      if (!isFunctionResponse(userInput)) {
        outputContents.push({
          role: 'model',
          parts: [],
        } as Content);
      }
    }
    if (
      automaticFunctionCallingHistory &&
      automaticFunctionCallingHistory.length > 0
    ) {
      this.history.push(
        ...extractCuratedHistory(automaticFunctionCallingHistory),
      );
    } else {
      this.history.push(userInput);
    }

    // Consolidate adjacent model roles in outputContents
    const consolidatedOutputContents: Content[] = [];
    for (const content of outputContents) {
      if (this.isThoughtContent(content)) {
        continue;
      }
      const lastContent =
        consolidatedOutputContents[consolidatedOutputContents.length - 1];
      if (this.isTextContent(lastContent) && this.isTextContent(content)) {
        // If both current and last are text, combine their text into the lastContent's first part
        // and append any other parts from the current content.
        lastContent.parts[0].text += content.parts[0].text || '';
        if (content.parts.length > 1) {
          lastContent.parts.push(...content.parts.slice(1));
        }
      } else {
        consolidatedOutputContents.push(content);
      }
    }

    if (consolidatedOutputContents.length > 0) {
      const lastHistoryEntry = this.history[this.history.length - 1];
      const canMergeWithLastHistory =
        !automaticFunctionCallingHistory ||
        automaticFunctionCallingHistory.length === 0;

      if (
        canMergeWithLastHistory &&
        this.isTextContent(lastHistoryEntry) &&
        this.isTextContent(consolidatedOutputContents[0])
      ) {
        // If both current and last are text, combine their text into the lastHistoryEntry's first part
        // and append any other parts from the current content.
        lastHistoryEntry.parts[0].text +=
          consolidatedOutputContents[0].parts[0].text || '';
        if (consolidatedOutputContents[0].parts.length > 1) {
          lastHistoryEntry.parts.push(
            ...consolidatedOutputContents[0].parts.slice(1),
          );
        }
        consolidatedOutputContents.shift(); // Remove the first element as it's merged
      }
      this.history.push(...consolidatedOutputContents);
    }
  }

  private isTextContent(
    content: Content | undefined,
  ): content is Content & { parts: [{ text: string }, ...Part[]] } {
    return !!(
      content &&
      content.role === 'model' &&
      content.parts &&
      content.parts.length > 0 &&
      typeof content.parts[0].text === 'string' &&
      content.parts[0].text !== ''
    );
  }

  private isThoughtContent(
    content: Content | undefined,
  ): content is Content & { parts: [{ thought: boolean }, ...Part[]] } {
    return !!(
      content &&
      content.role === 'model' &&
      content.parts &&
      content.parts.length > 0 &&
      typeof content.parts[0].thought === 'boolean' &&
      content.parts[0].thought === true
    );
  }

  /**
   * Handles Qwen OAuth authentication errors and rate limiting
   */
  private async handleQwenOAuthError(error?: unknown): Promise<string | null> {
    if (!error) {
      return null;
    }

    const errorMessage =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();
    const errorCode =
      (error as { status?: number; code?: number })?.status ||
      (error as { status?: number; code?: number })?.code;

    // Check if this is an authentication/authorization error
    const isAuthError =
      errorCode === 401 ||
      errorCode === 403 ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('forbidden') ||
      errorMessage.includes('invalid api key') ||
      errorMessage.includes('authentication') ||
      errorMessage.includes('access denied') ||
      (errorMessage.includes('token') && errorMessage.includes('expired'));

    // Check if this is a rate limiting error
    const isRateLimitError =
      errorCode === 429 ||
      errorMessage.includes('429') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests');

    if (isAuthError) {
      console.warn('Qwen OAuth authentication error detected:', errorMessage);
      // The QwenContentGenerator should automatically handle token refresh
      // If it still fails, it likely means the refresh token is also expired
      console.log(
        'Note: If this persists, you may need to re-authenticate with Qwen OAuth',
      );
      return null;
    }

    if (isRateLimitError) {
      console.warn('Qwen API rate limit encountered:', errorMessage);
      // For rate limiting, we don't need to do anything special
      // The retry mechanism will handle the backoff
      return null;
    }

    // For other errors, don't handle them specially
    return null;
  }
}
