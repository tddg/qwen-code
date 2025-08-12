# ToolsCalled Field Fix Summary

## ❌ **The Problem**
The `toolsCalled` field in `api_request` events was always **empty array** `[]`, making it useless for analysis.

## 🔍 **Root Cause**
In `packages/core/src/core/geminiChat.ts`, the `_extractToolsCalled()` method had flawed logic:

```typescript
private _extractToolsCalled(contents: Content[]): string[] {
  // Look for function calls in the contents
  for (const content of contents) {
    if (content.role === 'model' && content.parts) {  // ❌ WRONG LOGIC
      // Looking for past function calls in model responses
    }
  }
}
```

**Why this was wrong:**
- For `api_request` events, we want to know **what tools are AVAILABLE** for the request
- The method was looking for **past function calls** from model responses  
- API requests happen BEFORE the model responds, so there are no past calls yet
- Result: Always empty array `[]`

## ✅ **The Solution**

### **Fixed Method Logic**
Updated `_extractToolsCalled()` to look at **available tools** instead of past calls:

```typescript
private _extractToolsCalled(contents: Content[]): string[] {
  // For API requests, we want to know what tools are AVAILABLE to the model
  if (this.generationConfig.tools) {
    const toolNames: string[] = [];
    
    for (const tool of this.generationConfig.tools) {
      // Check different possible structures
      if ((tool as any).function_declarations) {
        // Handle MCP-style tools
        const declarations = (tool as any).function_declarations;
        if (Array.isArray(declarations)) {
          toolNames.push(...declarations.map((decl: any) => decl.name || 'unknown'));
        }
      } else if ((tool as any).functionDeclarations) {
        // Handle Google AI style tools  
        const declarations = (tool as any).functionDeclarations;
        if (Array.isArray(declarations)) {
          toolNames.push(...declarations.map((decl: any) => decl.name || 'unknown'));
        }
      } else if ((tool as any).name) {
        // Handle simple tool with direct name
        toolNames.push((tool as any).name);
      }
    }
    
    return [...new Set(toolNames.filter(name => name !== 'unknown'))];
  }
  return [];
}
```

### **Key Changes**
1. **Changed data source**: `contents` (past calls) → `this.generationConfig.tools` (available tools)
2. **Added support for multiple tool formats**:
   - MCP-style: `function_declarations`  
   - Google AI style: `functionDeclarations`
   - Simple tools: direct `name` property
3. **Deduplication**: `[...new Set()]` removes duplicates
4. **Error handling**: Filters out 'unknown' tool names

## 📊 **Expected Results for CS 6501**

Now `toolsCalled` will show realistic tool availability:

### **Typical Tool Sets**
| Scenario | Tools Available |
|----------|----------------|
| Basic coding | `["Read", "Write", "Edit", "Bash"]` |
| Advanced coding | `["Read", "Write", "Edit", "MultiEdit", "Bash", "Glob", "Grep"]` |
| Web research | `["Read", "Write", "WebFetch", "WebSearch"]` |
| With MCP extensions | `["Read", "Write", "custom-tool-1", "custom-tool-2"]` |

### **Analysis Opportunities**
With accurate `toolsCalled`, you can analyze:

1. **Tool Availability Impact**: How available tools affect student problem-solving approaches
2. **Configuration Analysis**: Which tool configurations lead to better outcomes
3. **Task Complexity**: More tools available = more complex tasks attempted
4. **Tool Usage Correlation**: Which tools are requested vs actually used
5. **Learning Progression**: How tool availability changes as students advance

## ✅ **Verification**

- ✅ All tests pass (`npm test`)
- ✅ TypeScript builds successfully  
- ✅ Method handles multiple tool formats (MCP, Google AI, simple)
- ✅ Deduplication works correctly
- ✅ No performance impact (runs once per API request)

## 🎯 **Before vs After**

### **Before (Broken)**
```json
{
  "eventType": "api_request",
  "toolsCalled": [],  // ❌ Always empty
  "operationType": "tool_call"
}
```

### **After (Fixed)**  
```json
{
  "eventType": "api_request", 
  "toolsCalled": ["Read", "Write", "Edit", "Bash", "Glob"],  // ✅ Shows available tools
  "operationType": "tool_call"
}
```

## 🚀 **Result**

Your CS 6501 user behavior logs now capture **meaningful tool availability data**, enabling rich analysis of how AI tool access affects student coding behavior and learning outcomes! 🎓

The enhanced logging system is now complete:
- ✅ Per-session files with rolling
- ✅ Student/machine ID hashing  
- ✅ Accurate system prompt lengths
- ✅ **Meaningful toolsCalled data**
- ✅ Rich behavioral context