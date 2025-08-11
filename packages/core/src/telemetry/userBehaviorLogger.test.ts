/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { UserBehaviorLogger, UserBehaviorEvent } from './userBehaviorLogger.js';
import { Config } from '../config/config.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock Config class
class MockConfig {
  getSessionId() {
    return 'test-session-id';
  }

  getTelemetryEnabled() {
    return true;
  }
}

describe('UserBehaviorLogger', () => {
  let logger: UserBehaviorLogger;
  let mockConfig: Config;
  let logFilePath: string;

  beforeEach(() => {
    mockConfig = new MockConfig() as unknown as Config;
    logger = UserBehaviorLogger.getInstance(mockConfig);
    logFilePath = logger.getLogFilePath();

    // Clear any existing log file
    if (fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
    }
  });

  afterEach(() => {
    // Clean up log file after each test
    if (fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
    }

    // Reset singleton instance
    // @ts-expect-error - accessing private field for testing
    UserBehaviorLogger.instance = undefined;
  });

  it('should create a log file in the logs directory', () => {
    expect(logFilePath).toContain('logs');
    expect(logFilePath).toContain('user-behavior.log');
  });

  it('should log user behavior events to file', async () => {
    const event: UserBehaviorEvent = {
      eventType: 'prompt_submit',
      timestamp: Date.now(),
      promptId: 'test-prompt-id',
      content: 'test prompt content',
      inputTokenCount: 10,
    };

    await logger.logEvent(event);

    // Check that the file was created and contains the event
    expect(fs.existsSync(logFilePath)).toBe(true);

    const logContent = fs.readFileSync(logFilePath, 'utf-8');
    const logLines = logContent.trim().split('\n');
    expect(logLines).toHaveLength(1);

    const loggedEvent = JSON.parse(logLines[0]);
    expect(loggedEvent.eventType).toBe('prompt_submit');
    expect(loggedEvent.promptId).toBe('test-prompt-id');
    expect(loggedEvent.content).toBe('test prompt content');
    expect(loggedEvent.inputTokenCount).toBe(10);
    expect(loggedEvent.sessionId).toBe('test-session-id');
  });

  it('should handle multiple events in the same log file', async () => {
    const events: UserBehaviorEvent[] = [
      {
        eventType: 'typing_start',
        timestamp: Date.now(),
        promptId: 'prompt-1',
      },
      {
        eventType: 'prompt_submit',
        timestamp: Date.now() + 1000,
        promptId: 'prompt-1',
        content: 'first prompt',
      },
      {
        eventType: 'api_request',
        timestamp: Date.now() + 2000,
        promptId: 'prompt-1',
        model: 'test-model',
      },
    ];

    for (const event of events) {
      await logger.logEvent(event);
    }

    const logContent = fs.readFileSync(logFilePath, 'utf-8');
    const logLines = logContent.trim().split('\n');
    expect(logLines).toHaveLength(3);

    const loggedEvents = logLines.map((line) => JSON.parse(line));
    expect(loggedEvents[0].eventType).toBe('typing_start');
    expect(loggedEvents[1].eventType).toBe('prompt_submit');
    expect(loggedEvents[2].eventType).toBe('api_request');
  });

  it('should not log when telemetry is disabled', async () => {
    // Create a mock config with telemetry disabled
    class MockConfigDisabled {
      getSessionId() {
        return 'test-session-id';
      }

      getTelemetryEnabled() {
        return false;
      }
    }

    const disabledConfig = new MockConfigDisabled() as unknown as Config;
    // Get instance through the singleton pattern
    const loggerWithDisabledTelemetry =
      UserBehaviorLogger.getInstance(disabledConfig);

    // Reset singleton instance for this test to ensure we get a fresh instance
    // @ts-expect-error - accessing private field for testing
    UserBehaviorLogger.instance = undefined;

    // Get a new instance with disabled telemetry
    const freshLoggerWithDisabledTelemetry =
      UserBehaviorLogger.getInstance(disabledConfig);
    const disabledLogFilePath =
      freshLoggerWithDisabledTelemetry.getLogFilePath();

    // Clear any existing log file
    if (fs.existsSync(disabledLogFilePath)) {
      fs.unlinkSync(disabledLogFilePath);
    }

    const event: UserBehaviorEvent = {
      eventType: 'prompt_submit',
      timestamp: Date.now(),
      promptId: 'test-prompt-id',
    };

    await freshLoggerWithDisabledTelemetry.logEvent(event);

    // Check that no file was created
    expect(fs.existsSync(disabledLogFilePath)).toBe(false);
  });

  it('should handle logging errors gracefully', async () => {
    // Temporarily replace the log file path with a non-writable location
    const originalGetLogFilePath = logger.getLogFilePath;
    logger.getLogFilePath = vi
      .fn()
      .mockReturnValue('/invalid/path/to/logfile.log');

    const event: UserBehaviorEvent = {
      eventType: 'prompt_submit',
      timestamp: Date.now(),
      promptId: 'test-prompt-id',
    };

    // This should not throw an error
    await expect(logger.logEvent(event)).resolves.toBeUndefined();

    // Restore original function
    logger.getLogFilePath = originalGetLogFilePath;
  });

  it('should log typing start events', async () => {
    const promptId = 'test-prompt-id';
    logger.logTypingStart(promptId);

    // Wait a bit for the async logging to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    const logContent = fs.readFileSync(logFilePath, 'utf-8');
    const logLines = logContent.trim().split('\n');
    expect(logLines).toHaveLength(1);

    const loggedEvent = JSON.parse(logLines[0]);
    expect(loggedEvent.eventType).toBe('typing_start');
    expect(loggedEvent.promptId).toBe(promptId);
  });

  it('should log prompt submit events', async () => {
    const mockUserPromptEvent = {
      prompt_length: 100,
      prompt_id: 'test-prompt-id',
      prompt: 'test prompt content',
    } as any;

    logger.logPromptSubmit(mockUserPromptEvent);

    // Wait a bit for the async logging to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    const logContent = fs.readFileSync(logFilePath, 'utf-8');
    const logLines = logContent.trim().split('\n');
    expect(logLines).toHaveLength(1);

    const loggedEvent = JSON.parse(logLines[0]);
    expect(loggedEvent.eventType).toBe('prompt_submit');
    expect(loggedEvent.promptId).toBe('test-prompt-id');
    expect(loggedEvent.content).toBe('test prompt content');
    expect(loggedEvent.inputTokenCount).toBe(100);
  });

  it('should log API request events', async () => {
    const model = 'test-model';
    const promptId = 'test-prompt-id';

    logger.logApiRequest(model, promptId);

    // Wait a bit for the async logging to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    const logContent = fs.readFileSync(logFilePath, 'utf-8');
    const logLines = logContent.trim().split('\n');
    expect(logLines).toHaveLength(1);

    const loggedEvent = JSON.parse(logLines[0]);
    expect(loggedEvent.eventType).toBe('api_request');
    expect(loggedEvent.model).toBe('test-model');
    expect(loggedEvent.promptId).toBe('test-prompt-id');
  });

  it('should log API response events', async () => {
    const model = 'test-model';
    const promptId = 'test-prompt-id';
    const inputTokenCount = 50;
    const outputTokenCount = 75;
    const durationMs = 1234;

    logger.logApiResponse(
      model,
      promptId,
      inputTokenCount,
      outputTokenCount,
      durationMs,
    );

    // Wait a bit for the async logging to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    const logContent = fs.readFileSync(logFilePath, 'utf-8');
    const logLines = logContent.trim().split('\n');
    expect(logLines).toHaveLength(1);

    const loggedEvent = JSON.parse(logLines[0]);
    expect(loggedEvent.eventType).toBe('api_response');
    expect(loggedEvent.model).toBe('test-model');
    expect(loggedEvent.promptId).toBe('test-prompt-id');
    expect(loggedEvent.inputTokenCount).toBe(50);
    expect(loggedEvent.outputTokenCount).toBe(75);
    expect(loggedEvent.durationMs).toBe(1234);
  });
});
