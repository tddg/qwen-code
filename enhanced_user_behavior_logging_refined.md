# Enhanced User Behavior Logging - Refined Implementation

This document describes the current state of user behavior logging in the Qwen CLI, which captures detailed information about user interactions and system responses.

## Overview

The user behavior logging system records various events that occur during user interactions with the Qwen CLI. These events are stored in a structured JSON format in the `logs/user-behavior.log` file.

## Event Types

The system logs several types of events:

1. `prompt_submit` - User submits a prompt
2. `prompt_cancel` - User cancels a prompt
3. `typing_start` - User begins typing
4. `api_request` - API request is made
5. `api_response` - API response is received
6. `api_error` - API error occurs
7. `flash_fallback` - Flash fallback is triggered
8. `loop_detected` - Loop detection is triggered
9. `at_command` - @command is used
10. `shell_command` - Shell command is executed

## Common Fields

All events include these common fields:
- `eventType`: Type of event
- `timestamp`: When the event occurred (in ISO format)
- `sessionId`: Unique identifier for the session
- `model`: The model being used (when applicable)
- `promptId`: Unique identifier for the prompt (when applicable)

## API Request Events

When the CLI makes a request to the API, the following information is logged:

- `operation_type`: Type of operation being performed:
  - `chat`: Regular conversation
  - `tool_call`: Request to execute tools
  - `completion`: Text completion task
  - `embedding`: Embedding generation
  - `unknown`: Unidentified operation type
- `tools_called`: Array of tool names being requested
- `request_context`: Context of the request:
  - `new`: New conversation
  - `continuation`: Continuation of existing conversation
  - `tool_result`: Response to a tool call
- `estimated_input_tokens`: Estimated number of tokens in the request
- `conversation_turn`: Turn number in the conversation
- `has_file_context`: Whether file context is included in the request
- `system_prompt_length`: Length of the system prompt
- `request_text`: The text of the request (when telemetry is configured to log prompts)

## API Response Events

When the CLI receives a response from the API, the following information is logged:

- `response_type`: Type of response received:
  - `tool_call`: Request to execute tools
  - `text_response`: Text response
  - `mixed`: Mixed content response
  - `error`: Error response
  - `streaming_chunk`: Streaming chunk
- `duration_ms`: How long the API call took
- `input_token_count`: Number of tokens in the request
- `output_token_count`: Number of tokens in the response
- `cached_content_token_count`: Number of tokens from cached content
- `thoughts_token_count`: Number of tokens used for thoughts
- `tool_token_count`: Number of tokens used for tool calls
- `total_token_count`: Total number of tokens
- `response_text`: The text of the response (when telemetry is configured to log prompts)
- `error`: Error message (when applicable)
- `status_code`: HTTP status code (when applicable)

## Privacy Considerations

The logging system is designed with privacy in mind:

- User prompts and responses are only logged when telemetry is explicitly configured to do so
- Sensitive information is not logged in the enhanced fields
- All logging is opt-in and can be disabled through configuration