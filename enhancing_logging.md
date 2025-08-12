# Enhancing Qwen CLI Logging for Detailed API Operations

This document outlines plans to enhance the telemetry logging system in the Qwen CLI to capture more detailed information about API requests and responses.

## Current State

The current logging system captures basic information:

- `api_request`: model name, prompt ID
- `api_response`: model name, prompt ID, token counts, duration

## Proposed Enhancements

### API Request Enhancements

#### 1. Extended ApiRequestEvent Interface

```typescript
export interface EnhancedApiRequestEvent {
  model: string;
  prompt_id: string;
  operation_type?:
    | 'chat'
    | 'completion'
    | 'embedding'
    | 'tool_call'
    | 'unknown';
  tools_called?: string[]; // Array of tool names being requested
  request_context?: 'new' | 'continuation' | 'tool_result'; // Context of the request
  estimated_input_tokens?: number; // Estimated tokens before sending
  conversation_turn?: number; // Turn number in the conversation
  has_file_context?: boolean; // Whether file context is included
  system_prompt_length?: number; // Length of system prompt
}
```

#### 2. Enhanced Log Entries

```json
{
  "eventType": "api_request",
  "timestamp": "2025-08-09T17:38:46.892Z",
  "model": "qwen3-coder-plus",
  "promptId": "unique-prompt-id",
  "operationType": "tool_call",
  "toolsCalled": ["read_file", "list_directory"],
  "requestContext": "continuation",
  "estimatedTokens": 2345,
  "conversationTurn": 3,
  "hasFileContext": true,
  "systemPromptLength": 1200,
  "sessionId": "session-id"
}
```

### API Response Enhancements

#### 1. Extended ApiResponseEvent Interface

```typescript
export interface EnhancedApiResponseEvent extends ApiResponseEvent {
  responseType?:
    | 'tool_call'
    | 'text_response'
    | 'mixed'
    | 'error'
    | 'streaming_chunk';
  toolCalls?: Array<{
    name: string;
    id?: string;
    argument_summary?: Record<string, any>; // Non-sensitive summary
  }>;
  contentAnalysis?: {
    category?: 'code' | 'explanation' | 'command' | 'conversation' | 'mixed';
    hasCodeBlocks?: boolean;
    languages?: string[];
    fileReferences?: number;
    structure?: {
      paragraphs?: number;
      bulletPoints?: number;
      codeBlocks?: number;
    };
  };
  qualityMetrics?: {
    completeness?: 'complete' | 'partial' | 'streaming';
    confidence?: number; // 0-1 scale
    needsFollowUp?: boolean;
  };
  semanticIndicators?: {
    isClarification?: boolean;
    isRefusal?: boolean;
    isRedirect?: boolean;
    containsCommands?: string[];
    apologyPresent?: boolean;
  };
}
```

#### 2. Enhanced Log Entries

```json
{
  "eventType": "api_response",
  "timestamp": "2025-08-09T17:38:50.979Z",
  "model": "qwen3-coder-plus",
  "promptId": "unique-prompt-id",
  "inputTokenCount": 11923,
  "outputTokenCount": 57,
  "durationMs": 4085,
  "responseType": "tool_call",
  "toolCalls": [
    {
      "name": "read_file",
      "argument_summary": { "path": "file_pattern" }
    }
  ],
  "contentAnalysis": {
    "category": "code",
    "hasCodeBlocks": true,
    "languages": ["javascript"]
  },
  "qualityMetrics": {
    "completeness": "complete",
    "needsFollowUp": false
  },
  "sessionId": "session-id"
}
```

## Implementation Plan

### Phase 1: Core Infrastructure

1. Extend the event interfaces in `types.ts`
2. Update the logging functions in `loggers.ts`
3. Modify `UserBehaviorLogger` to handle new fields
4. Ensure backward compatibility with optional fields

### Phase 2: Data Collection Points

1. Enhance API request construction to capture operation types
2. Add tool call detection in request preparation
3. Implement content analysis for responses
4. Add semantic indicator detection

### Phase 3: Privacy and Performance

1. Implement data sanitization for sensitive information
2. Add configuration options for detailed logging
3. Optimize performance impact of content analysis
4. Add documentation for new telemetry fields

## Privacy Considerations

### Data Protection Measures

- Avoid logging full tool arguments or sensitive file paths
- Use summaries and classifications instead of verbatim content
- Implement data sanitization for potentially sensitive information
- Make detailed logging configurable via telemetry settings

### Sensitive Information Handling

- File paths should be generalized or omitted
- Tool arguments should be summarized rather than recorded verbatim
- Code content should be analyzed structurally rather than recorded
- User prompts are already logged in `prompt_submit` events

## Benefits

### Analytics and Insights

1. **Tool Usage Analysis**: Track which tools are most commonly called
2. **Performance Analysis**: Correlate tool usage with response times
3. **Response Effectiveness**: Understand response quality and completeness
4. **Usage Patterns**: Identify common operation types and workflows
5. **Content Intelligence**: Analyze what types of content are generated

### System Improvements

1. **Debugging**: Easier to trace complex interactions
2. **Optimization**: Focus improvements on heavily used operations
3. **Quality Assurance**: Monitor for response issues or degradation
4. **Feature Development**: Data-driven feature prioritization

## Integration Points

### Key Files to Modify

1. `packages/core/src/telemetry/types.ts` - Extend interfaces
2. `packages/core/src/telemetry/loggers.ts` - Update logging functions
3. `packages/core/src/telemetry/userBehaviorLogger.ts` - Enhance logger
4. `packages/core/src/core/geminiChat.ts` - Add data collection
5. `packages/core/src/core/contentGenerator.ts` - Enhance request/response handling

### Testing Considerations

1. Update unit tests for new event types
2. Add integration tests for enhanced logging
3. Verify backward compatibility
4. Test privacy protections

## Configuration Options

### Telemetry Settings

```json
{
  "telemetry": {
    "enabled": true,
    "target": "local",
    "logPrompts": true,
    "enhancedLogging": {
      "apiRequests": true,
      "apiResponses": true,
      "detailLevel": "full" // or "basic", "none"
    }
  }
}
```

This enhancement will provide significantly richer telemetry data while maintaining the existing privacy and performance characteristics of the system.
