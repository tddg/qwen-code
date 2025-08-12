# Enhanced Logging Demo

This document demonstrates the enhanced logging features for the Qwen CLI.

## Overview

The enhanced logging system captures more detailed information about API requests and responses, providing deeper insights into user interactions and system performance.

## Example Log Entries

### Enhanced API Request Log

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

### Enhanced API Response Log

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

## Data Collection Methods

The enhanced logging system uses several helper methods to collect data:

### Operation Type Detection

The system can detect different types of operations:

- `chat`: Regular conversation
- `tool_call`: Requests to execute tools
- `completion`: Text completion tasks
- `embedding`: Embedding generation
- `unknown`: Unidentified operation type

### Tool Usage Tracking

The system tracks which tools are being called:

- `toolsCalled`: Array of tool names
- `argument_summary`: Sanitized view of tool arguments

### Content Analysis

The system analyzes response content:

- `category`: Type of content (code, explanation, command, etc.)
- `hasCodeBlocks`: Whether the response contains code
- `languages`: Programming languages detected in code blocks
- `fileReferences`: Number of file references in the response
- `structure`: Content structure analysis (paragraphs, bullet points, code blocks)

### Quality Metrics

The system assesses response quality:

- `completeness`: Whether the response is complete
- `confidence`: Confidence level in the response (0-1 scale)
- `needsFollowUp`: Whether a follow-up is needed

### Semantic Indicators

The system detects semantic patterns:

- `isClarification`: Whether the response is asking for clarification
- `isRefusal`: Whether the response is refusing a request
- `isRedirect`: Whether the response is redirecting to something else
- `containsCommands`: Types of commands in the response
- `apologyPresent`: Whether an apology is present in the response

## Privacy Protections

The enhanced logging system includes several privacy protections:

- Tool arguments are sanitized and summarized rather than logged verbatim
- File paths are detected but not logged in detail
- Content analysis focuses on structural patterns rather than specific content
- All enhanced logging is configurable and can be disabled

## Configuration

The enhanced logging features can be configured through the telemetry settings:

```json
{
  "telemetry": {
    "enabled": true,
    "target": "local",
    "logPrompts": true,
    "enhancedLogging": {
      "apiRequests": true,
      "apiResponses": true,
      "detailLevel": "full"
    }
  }
}
```

## Benefits

The enhanced logging system provides several benefits:

- Better debugging and troubleshooting capabilities
- Deeper insights into system behavior and performance
- Improved ability to optimize tool usage
- Enhanced analytics for user behavior analysis
- Better understanding of feature usage patterns
- Data-driven decision making for feature development
