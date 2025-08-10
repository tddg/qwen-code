# Qwen CLI User Behavior Log Mechanism Explained

This document explains the user behavior logging mechanism implemented in the Qwen CLI, based on analysis of the log entries and source code.

## Overview

The Qwen CLI implements comprehensive user behavior logging to track user interactions and system performance. The logging system captures four key event types in the user interaction flow:

1. **typing_start** - When a user begins typing in the input prompt
2. **prompt_submit** - When a user submits a prompt to the AI
3. **api_request** - When an API request is sent to the AI service
4. **api_response** - When an API response is received from the AI service

## Log Structure

All events are logged to `./logs/user-behavior.log` in JSONL format (one JSON object per line).

### Common Fields
- `eventType`: One of the four event types above
- `timestamp`: ISO timestamp of the event
- `promptId`: Unique identifier to correlate events from the same user prompt
- `sessionId`: Session identifier to group events from the same CLI session

### Event-Specific Fields

#### typing_start
```json
{
  "eventType": "typing_start",
  "timestamp": "2025-08-09T17:38:04.695Z",
  "promptId": "unique-prompt-id",
  "sessionId": "session-id"
}
```

#### prompt_submit
```json
{
  "eventType": "prompt_submit",
  "timestamp": "2025-08-09T17:38:46.787Z",
  "promptId": "unique-prompt-id",
  "content": "user's actual prompt text",
  "inputTokenCount": 23,
  "sessionId": "session-id"
}
```

#### api_request
```json
{
  "eventType": "api_request",
  "timestamp": "2025-08-09T17:38:46.892Z",
  "model": "qwen3-coder-plus",
  "promptId": "unique-prompt-id",
  "sessionId": "session-id"
}
```

#### api_response
```json
{
  "eventType": "api_response",
  "timestamp": "2025-08-09T17:38:50.979Z",
  "model": "qwen3-coder-plus",
  "promptId": "unique-prompt-id",
  "inputTokenCount": 11923,
  "outputTokenCount": 57,
  "durationMs": 4085,
  "sessionId": "session-id"
}
```

## Key Behavioral Patterns Observed

### 1. Multiple API Requests/Responses per Prompt Submit

A single `prompt_submit` often triggers multiple `api_request`/`api_response` pairs due to:

- **Streaming Responses**: AI models return responses in chunks, each logged as a separate `api_response`
- **Retries**: System automatically retries failed requests
- **Tool Calling**: Multi-step process involving tool execution and follow-up requests
- **Model Cascading**: Fallback from one model to another

### 2. High Input Token Counts with Low Output Token Counts

This is normal behavior:
- **Input tokens**: Represent the entire conversation context (system prompts, previous messages, file context, current prompt)
- **Output tokens**: Represent only the model's response to the current request
- Example: 72,609 input tokens vs 84 output tokens is typical for contextual AI responses

### 3. API Requests Without Token Information

API requests don't include token counts because:
- Token information is only available after receiving the response
- Privacy considerations - full request payloads can contain sensitive information
- The `api_request` event only logs metadata needed for tracking

## Event Correlation

All related events share the same `promptId`, allowing you to:
- Trace the complete flow from user submission to final AI response
- Analyze retry patterns and streaming behavior
- Measure end-to-end latency for user interactions

## Implementation Details

### Logging Infrastructure
- **Location**: `./logs/user-behavior.log` relative to where the CLI is executed
- **Method**: Synchronous file append for immediate persistence
- **Format**: JSONL (JSON objects on separate lines)
- **Conditional**: Only logs when telemetry is enabled

### Privacy Considerations
- Prompt content is only logged in `prompt_submit` events
- API request payloads are not logged to protect sensitive information
- All logs are stored locally in the project's `logs` directory

### Error Handling
- Logging errors are silently ignored to never interrupt the user experience
- File system operations use synchronous methods for reliability

## Data Flow

1. User interacts with the CLI interface
2. Events are captured at specific interaction points
3. Events are logged to `./logs/user-behavior.log` in real-time
4. Each event is written as a separate JSON line with timestamp and session information

## Normal vs. Abnormal Patterns

### Normal Patterns
- Multiple `api_response` entries per `api_request` (streaming)
- Large input token counts with smaller output token counts
- `api_request` entries with only model and promptId information

### Patterns Requiring Investigation
- `api_request` without corresponding `api_response` (potential failures)
- Consistently zero token counts in `api_response` entries
- Excessive retry patterns (systematic failures)

This logging mechanism provides valuable insights into user behavior and system performance while respecting privacy considerations.