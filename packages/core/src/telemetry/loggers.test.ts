/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { logUserPrompt, logApiRequest, logApiResponse } from './loggers.js';
import { UserBehaviorLogger } from './userBehaviorLogger.js';
import { Config } from '../config/config.js';

// Mock the external dependencies
vi.mock('@opentelemetry/api-logs', () => ({
  logs: {
    getLogger: () => ({
      emit: vi.fn(),
    }),
  },
  LogRecord: vi.fn(),
  LogAttributes: vi.fn(),
}));

vi.mock('@opentelemetry/semantic-conventions', () => ({
  SemanticAttributes: {
    HTTP_STATUS_CODE: 'http.status_code',
  },
}));

vi.mock('./sdk.js', () => ({
  isTelemetrySdkInitialized: () => true,
}));

vi.mock('./uiTelemetry.js', () => ({
  uiTelemetryService: {
    addEvent: vi.fn(),
  },
}));

vi.mock('./clearcut-logger/clearcut-logger.js', () => ({
  ClearcutLogger: {
    getInstance: () => ({
      logNewPromptEvent: vi.fn(),
      logApiRequestEvent: vi.fn(),
      logApiResponseEvent: vi.fn(),
    }),
  },
}));

vi.mock('../utils/safeJsonStringify.js', () => ({
  safeJsonStringify: (obj: any) => JSON.stringify(obj),
}));

// Mock Config class
class MockConfig {
  getSessionId() {
    return 'test-session-id';
  }

  getTelemetryLogPromptsEnabled() {
    return true;
  }

  getTelemetryEnabled() {
    return true;
  }
}

describe('Logger modifications', () => {
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = new MockConfig() as unknown as Config;

    // Mock the UserBehaviorLogger methods
    vi.spyOn(
      UserBehaviorLogger.prototype,
      'logPromptSubmit',
    ).mockImplementation(() => Promise.resolve());
    vi.spyOn(UserBehaviorLogger.prototype, 'logApiRequest').mockImplementation(
      () => Promise.resolve(),
    );
    vi.spyOn(UserBehaviorLogger.prototype, 'logApiResponse').mockImplementation(
      () => Promise.resolve(),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should call UserBehaviorLogger when logging user prompt', () => {
    const mockUserPromptEvent = {
      prompt_length: 100,
      prompt_id: 'test-prompt-id',
      prompt: 'test prompt content',
    } as any;

    logUserPrompt(mockConfig, mockUserPromptEvent);

    expect(UserBehaviorLogger.prototype.logPromptSubmit).toHaveBeenCalledWith(
      mockUserPromptEvent,
    );
  });

  it('should call UserBehaviorLogger when logging API request', () => {
    const mockApiRequestEvent = {
      model: 'test-model',
      prompt_id: 'test-prompt-id',
    } as any;

    logApiRequest(mockConfig, mockApiRequestEvent);

    expect(UserBehaviorLogger.prototype.logApiRequest).toHaveBeenCalledWith(
      'test-model',
      'test-prompt-id',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  });

  it('should call UserBehaviorLogger when logging API response', () => {
    const mockApiResponseEvent = {
      model: 'test-model',
      prompt_id: 'test-prompt-id',
      input_token_count: 50,
      output_token_count: 75,
      duration_ms: 1234,
    } as any;

    logApiResponse(mockConfig, mockApiResponseEvent);

    expect(UserBehaviorLogger.prototype.logApiResponse).toHaveBeenCalledWith(
      'test-model',
      'test-prompt-id',
      50,
      75,
      1234,
      undefined,
    );
  });
});
