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
import * as crypto from 'crypto';
import * as os from 'os';

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
  requestId?: string; // Unique identifier linking requests and responses
  content?: string;
  inputTokenCount?: number;
  outputTokenCount?: number;
  durationMs?: number;
  error?: string;
  errorType?: string;
  authType?: string;
  sessionId?: string;
  // Educational analytics fields
  studentIdHash?: string;
  machineIdHash?: string;
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
  private logDir: string;
  private currentLogFilePath: string;
  private currentRollNumber: number = 0;
  private readonly maxFileSize: number = 10 * 1024 * 1024; // 10MB
  private studentIdHash: string;
  private machineIdHash: string;

  private constructor(private config: Config) {
    this.logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    
    this.studentIdHash = this.generateStudentIdHash();
    this.machineIdHash = this.generateMachineIdHash();
    this.currentLogFilePath = this.generateLogFilePath();
  }

  static getInstance(config: Config): UserBehaviorLogger {
    if (!UserBehaviorLogger.instance) {
      UserBehaviorLogger.instance = new UserBehaviorLogger(config);
    }
    return UserBehaviorLogger.instance;
  }

  private generateStudentIdHash(): string {
    // Try to get student ID from environment variable or user input
    const studentId = process.env.QWEN_STUDENT_ID || process.env.USER || os.userInfo().username || 'anonymous';
    return crypto.createHash('sha256').update(studentId).digest('hex').substring(0, 16);
  }

  private generateMachineIdHash(): string {
    // Create a consistent machine identifier based on multiple factors
    const machineInfo = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || 'unknown',
      process.env.HOME || process.env.USERPROFILE || 'unknown'
    ].join('|');
    
    return crypto.createHash('sha256').update(machineInfo).digest('hex').substring(0, 16);
  }

  private generateLogFilePath(): string {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const sessionId = this.config.getSessionId().substring(0, 8); // First 8 chars of session ID
    
    const baseFileName = `${dateStr}-${sessionId}`;
    const rollSuffix = this.currentRollNumber > 0 ? `-${this.currentRollNumber}` : '';
    
    return path.join(this.logDir, `${baseFileName}${rollSuffix}.jsonl`);
  }

  private checkAndRollFile(logLine: string): void {
    if (fs.existsSync(this.currentLogFilePath)) {
      const stats = fs.statSync(this.currentLogFilePath);
      const projectedSize = stats.size + Buffer.byteLength(logLine, 'utf8');
      
      if (projectedSize > this.maxFileSize) {
        this.currentRollNumber++;
        this.currentLogFilePath = this.generateLogFilePath();
      }
    }
  }

  async logEvent(event: UserBehaviorEvent): Promise<void> {
    if (!this.config.getTelemetryEnabled()) {
      return;
    }

    try {
      const logEntry = {
        ...event,
        sessionId: this.config.getSessionId(),
        studentIdHash: this.studentIdHash,
        machineIdHash: this.machineIdHash,
        timestamp: new Date(event.timestamp).toISOString(),
      };

      const logLine = safeJsonStringify(logEntry) + '\n';

      // Check if we need to roll to a new file
      this.checkAndRollFile(logLine);

      // Append to current log file
      fs.appendFileSync(this.currentLogFilePath, logLine);
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
    requestId: string,
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
      requestId,
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
    requestId: string,
    inputTokenCount: number,
    outputTokenCount: number,
    durationMs: number,
    responseType?: 'tool_call' | 'text_response' | 'mixed' | 'error' | 'streaming_chunk',
  ): void {
    this.logEvent({
      eventType: 'api_response',
      timestamp: Date.now(),
      model,
      promptId,
      requestId,
      inputTokenCount,
      outputTokenCount,
      durationMs,
      responseType,
    }).catch(() => {
      // Silently ignore logging errors
    });
  }

  getLogFilePath(): string {
    return this.currentLogFilePath;
  }

  getStudentIdHash(): string {
    return this.studentIdHash;
  }

  getMachineIdHash(): string {
    return this.machineIdHash;
  }

  getCurrentRollNumber(): number {
    return this.currentRollNumber;
  }
}
