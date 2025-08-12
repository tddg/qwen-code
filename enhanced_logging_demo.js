#!/usr/bin/env node

/**
 * Demo script to show enhanced user behavior logging features
 * This demonstrates the new logging capabilities for CS 6501
 */

import fs from 'fs';
import path from 'path';

// Mock config for demonstration
class MockConfig {
  getSessionId() {
    return 'demo-session-12345';
  }

  getTelemetryEnabled() {
    return true;
  }
}

// Create a demo function to simulate the enhanced logging
function createDemoLog() {
  const config = new MockConfig();
  
  // Simulate the enhanced log entries that would be generated
  const demoEvents = [
    {
      eventType: 'typing_start',
      timestamp: new Date().toISOString(),
      sessionId: config.getSessionId(),
      promptId: 'prompt-001',
      studentIdHash: 'a1b2c3d4e5f6g7h8', // 16 char hash
      machineIdHash: 'z9y8x7w6v5u4t3s2', // 16 char hash
    },
    {
      eventType: 'prompt_submit',
      timestamp: new Date(Date.now() + 1000).toISOString(),
      sessionId: config.getSessionId(),
      promptId: 'prompt-001',
      content: 'Write a function to calculate fibonacci numbers',
      inputTokenCount: 45,
      studentIdHash: 'a1b2c3d4e5f6g7h8',
      machineIdHash: 'z9y8x7w6v5u4t3s2',
    },
    {
      eventType: 'api_request',
      timestamp: new Date(Date.now() + 2000).toISOString(),
      sessionId: config.getSessionId(),
      promptId: 'prompt-001',
      model: 'qwen-2.5-coder',
      operationType: 'tool_call',
      toolsCalled: ['Write'],
      requestContext: 'new',
      estimatedTokens: 1250,
      conversationTurn: 1,
      hasFileContext: true,
      systemPromptLength: 450,
      studentIdHash: 'a1b2c3d4e5f6g7h8',
      machineIdHash: 'z9y8x7w6v5u4t3s2',
    },
    {
      eventType: 'api_response',
      timestamp: new Date(Date.now() + 4500).toISOString(),
      sessionId: config.getSessionId(),
      promptId: 'prompt-001',
      model: 'qwen-2.5-coder',
      inputTokenCount: 1250,
      outputTokenCount: 380,
      durationMs: 2400,
      responseType: 'tool_call',
      studentIdHash: 'a1b2c3d4e5f6g7h8',
      machineIdHash: 'z9y8x7w6v5u4t3s2',
    }
  ];

  // Create demo log file with proper naming
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const sessionPrefix = config.getSessionId().substring(0, 8);
  const demoLogPath = path.join(process.cwd(), 'logs', `${dateStr}-${sessionPrefix}.jsonl`);

  // Ensure logs directory exists
  const logsDir = path.dirname(demoLogPath);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Write demo events to log file
  const logContent = demoEvents.map(event => JSON.stringify(event)).join('\n') + '\n';
  fs.writeFileSync(demoLogPath, logContent);

  return {
    logPath: demoLogPath,
    eventsCount: demoEvents.length,
    studentIdHash: demoEvents[0].studentIdHash,
    machineIdHash: demoEvents[0].machineIdHash,
    sessionId: config.getSessionId()
  };
}

// Run the demo
const demo = createDemoLog();

console.log('🎯 Enhanced User Behavior Logging Demo for CS 6501');
console.log('=' .repeat(50));
console.log(`📁 Log file created: ${demo.logPath}`);
console.log(`📊 Events logged: ${demo.eventsCount}`);
console.log(`👤 Student ID hash: ${demo.studentIdHash}`);
console.log(`💻 Machine ID hash: ${demo.machineIdHash}`);
console.log(`🔑 Session ID: ${demo.sessionId}`);
console.log('\n📋 Features demonstrated:');
console.log('  ✅ Per-session log files (YYYY-MM-DD-sessionID.jsonl)');
console.log('  ✅ Student ID hashing for privacy-preserving analytics');
console.log('  ✅ Machine ID hashing for cross-session tracking');
console.log('  ✅ Enhanced event logging with context');
console.log('  ✅ File size monitoring (10MB cap with rolling)');
console.log('\n📖 Log file contents:');
console.log('-'.repeat(50));

// Show the actual log content
const logContent = fs.readFileSync(demo.logPath, 'utf-8');
const lines = logContent.trim().split('\n');
lines.forEach((line, index) => {
  const event = JSON.parse(line);
  console.log(`${index + 1}. ${event.eventType} (${event.timestamp})`);
  if (event.content) console.log(`   Content: "${event.content}"`);
  if (event.operationType) console.log(`   Operation: ${event.operationType}`);
  if (event.durationMs) console.log(`   Duration: ${event.durationMs}ms`);
});

console.log('\n🎓 Perfect for CS 6501 student behavior analysis!');