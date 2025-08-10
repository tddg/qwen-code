# User Behavior Logging Implementation

This document describes the implementation of user behavior logging in the Qwen CLI application. The system captures key user interactions and API usage metrics for telemetry purposes.

## Overview

The user behavior logging system tracks four key events in the user interaction flow:
1. **Typing Start** - When a user begins typing in the input prompt
2. **Prompt Submission** - When a user submits a prompt to the AI
3. **API Request** - When an API request is sent to the AI service
4. **API Response** - When an API response is received from the AI service

## Core Implementation

### UserBehaviorLogger Class

The primary implementation is in `packages/core/src/telemetry/userBehaviorLogger.ts`. This singleton class handles all user behavior logging:

- **Log Location**: `./logs/user-behavior.log` (relative to where the CLI is executed)
- **Write Method**: Synchronous file append (`fs.appendFileSync`) for immediate persistence
- **Format**: Each event is a JSON object on a separate line (JSONL format)
- **Conditional**: Only logs when telemetry is enabled (`config.getTelemetryEnabled()`)

### Event Types

```typescript
interface UserBehaviorEvent {
  eventType: 'typing_start' | 'prompt_submit' | 'api_request' | 'api_response';
  timestamp: number;
  promptId?: string;
  content?: string;
  inputTokenCount?: number;
  outputTokenCount?: number;
  model?: string;
  durationMs?: number;
}
```

## Integration Points

### 1. Typing Start Event

**Location**: `packages/cli/src/ui/components/InputPrompt.tsx`

- Triggered when the user types the first non-whitespace character in the input prompt
- Uses dynamic import to access the logger to avoid potential circular dependencies
- Sends a unique prompt ID combining session ID and timestamp

```typescript
if (buffer.text.length === 0 && key.sequence && key.sequence.trim()) {
  import('@qwen-code/qwen-code-core')
    .then((core) => {
      const logger = core.UserBehaviorLogger.getInstance(config);
      logger.logTypingStart(config.getSessionId() + '########' + Date.now());
    })
    .catch(() => {
      // Silently ignore logging errors
    });
}
```

### 2. Prompt Submission Event

**Location**: `packages/core/src/telemetry/loggers.ts`

- Called from `packages/cli/src/ui/hooks/useGeminiStream.ts` when preparing queries
- Logs the prompt content and length (if telemetry settings allow)
- Uses `UserBehaviorLogger.getInstance(config).logPromptSubmit(event)`

### 3. API Request Event

**Location**: `packages/core/src/telemetry/loggers.ts`

- Triggered when an API request is about to be sent
- Logs the model being used and the prompt ID
- Uses `UserBehaviorLogger.getInstance(config).logApiRequest(model, promptId)`

### 4. API Response Event

**Location**: `packages/core/src/telemetry/loggers.ts`

- Triggered when an API response is received
- Logs input/output token counts, model, and request duration
- Uses `UserBehaviorLogger.getInstance(config).logApiResponse(...)`

## Data Flow

1. User interacts with the CLI interface
2. Events are captured at specific interaction points
3. Events are logged to `./logs/user-behavior.log` in real-time
4. Each event is written as a separate JSON line with timestamp and session information

## Log File Structure

Example log entries:

```json
{"eventType":"typing_start","promptId":"session123########1678901234567","sessionId":"session123","timestamp":"2023-03-15T10:20:34.567Z"}
{"eventType":"prompt_submit","promptId":"session123########1678901234567","content":"What is the weather today?","inputTokenCount":10,"sessionId":"session123","timestamp":"2023-03-15T10:20:35.123Z"}
{"eventType":"api_request","model":"gemini-pro","promptId":"session123########1678901234567","sessionId":"session123","timestamp":"2023-03-15T10:20:35.456Z"}
{"eventType":"api_response","model":"gemini-pro","promptId":"session123########1678901234567","inputTokenCount":10,"outputTokenCount":50,"durationMs":1234,"sessionId":"session123","timestamp":"2023-03-15T10:20:36.690Z"}
```

## Configuration and Privacy

- Logging is only active when telemetry is enabled
- Prompt content logging is controlled by the `telemetryLogPromptsEnabled` setting
- All logs are stored locally in the project's `logs` directory
- Error handling is designed to never interrupt the user experience

## Testing

Unit tests for the user behavior logging are implemented in:
- `packages/cli/src/ui/components/InputPrompt.userBehavior.test.tsx` - Tests for typing start event logging

These tests mock the core logger to verify that events are properly triggered under the right conditions.