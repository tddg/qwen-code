/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';
import { UserPromptEvent } from './types.js';
import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import * as fs from 'fs';
import * as path from 'path';

export interface UserBehaviorEvent {
  eventType:
    | 'prompt_submit'
    | 'prompt_cancel'
    | 'typing_start'
    | 'api_request'
    | 'api_response'
    | 'api_error'
    | 'flash_fallback'
    | 'loop_detected'
    | 'at_command'
    | 'shell_command';
  timestamp: number;
  model?: string;
  promptId?: string;
  content?: string;
  inputTokenCount?: number;
  outputTokenCount?: number;
  durationMs?: number;
  error?: string;
  errorType?: string;
  authType?: string;
  sessionId?: string;
  // API request specific fields
  operationType?: 'chat' | 'tool_call' | 'completion' | 'embedding' | 'unknown';
  toolsCalled?: string[];
  requestContext?: 'new' | 'continuation' | 'tool_result';
  estimatedTokens?: number;
  conversationTurn?: number;
  hasFileContext?: boolean;
  systemPromptLength?: number;
  // API response specific fields
  responseType?:
    | 'tool_call'
    | 'text_response'
    | 'mixed'
    | 'error'
    | 'streaming_chunk';
}

export class UserBehaviorLogger {
  private static instance: UserBehaviorLogger;
  private logFilePath: string;
  private initialized: boolean = false;

  private constructor(private config: Config) {
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logFilePath = path.join(logDir, 'user-behavior.log');
  }

  static getInstance(config: Config): UserBehaviorLogger {
    if (!UserBehaviorLogger.instance) {
      UserBehaviorLogger.instance = new UserBehaviorLogger(config);
    }
    return UserBehaviorLogger.instance;
  }

  async logEvent(event: UserBehaviorEvent): Promise<void> {
    if (!this.config.getTelemetryEnabled()) {
      return;
    }

    try {
      const logEntry = {
        ...event,
        sessionId: this.config.getSessionId(),
        timestamp: new Date(event.timestamp).toISOString(),
      };

      const logLine = safeJsonStringify(logEntry) + '\n';

      // Append to log file
      fs.appendFileSync(this.logFilePath, logLine);
    } catch (error) {
      console.error('Failed to log user behavior event:', error);
    }
  }

  logTypingStart(promptId: string): void {
    this.logEvent({
      eventType: 'typing_start',
      timestamp: Date.now(),
      promptId,
    }).catch(() => {
      // Silently ignore logging errors
    });
  }

  logPromptSubmit(event: UserPromptEvent): void {
    this.logEvent({
      eventType: 'prompt_submit',
      timestamp: Date.now(),
      promptId: event.prompt_id,
      content: event.prompt,
      inputTokenCount: event.prompt_length,
    }).catch(() => {
      // Silently ignore logging errors
    });
  }

  logApiRequest(
    model: string,
    promptId: string,
    operationType?:
      | 'chat'
      | 'completion'
      | 'embedding'
      | 'tool_call'
      | 'unknown',
    toolsCalled?: string[],
    requestContext?: 'new' | 'continuation' | 'tool_result',
    estimatedTokens?: number,
    conversationTurn?: number,
    hasFileContext?: boolean,
    systemPromptLength?: number,
  ): void {
    this.logEvent({
      eventType: 'api_request',
      timestamp: Date.now(),
      model,
      promptId,
      operationType,
      toolsCalled,
      requestContext,
      estimatedTokens,
      conversationTurn,
      hasFileContext,
      systemPromptLength,
    }).catch(() => {
      // Silently ignore logging errors
    });
  }

  logApiResponse(
    model: string,
    promptId: string,
    inputTokenCount: number,
    outputTokenCount: number,
    durationMs: number,
    responseType?:
      | 'tool_call'
      | 'text_response'
      | 'mixed'
      | 'error'
      | 'streaming_chunk',
  ): void {
    this.logEvent({
      eventType: 'api_response',
      timestamp: Date.now(),
      model,
      promptId,
      inputTokenCount,
      outputTokenCount,
      durationMs,
      responseType,
    }).catch(() => {
      // Silently ignore logging errors
    });
  }

  getLogFilePath(): string {
    return this.logFilePath;
  }
}
