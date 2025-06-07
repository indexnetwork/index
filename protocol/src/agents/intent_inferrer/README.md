# Intent Inferrer Agent

This agent analyzes document collections using **LangChain's UnstructuredDirectoryLoader** and **LangGraph** workflows to generate intelligent intent suggestions based on the content found.

## Overview

The Intent Inferrer Agent has been completely rewritten to leverage LangChain's powerful document processing ecosystem. It now uses the **UnstructuredDirectoryLoader** for sophisticated document parsing and **LangGraph** for workflow automation, providing superior document analysis and intent generation.

## Features

- **🔄 LangGraph Workflow**: Automated 4-node processing pipeline with state management
- **📄 UnstructuredDirectoryLoader**: Native LangChain integration for document processing
- **🎯 Advanced Intent Generation**: AI-powered analysis with confidence scoring and prioritization
- **🔧 Flexible Configuration**: Works with API, local server, or basic text parsing
- **⚡ Async Processing**: Parallel document loading and processing
- **🛡️ Robust Error Handling**: Graceful fallbacks and comprehensive error reporting

## Architecture

The agent uses a **LangGraph StateGraph** with four specialized nodes:

1. **loadDocuments**: Uses UnstructuredDirectoryLoader for document ingestion
2. **analyzeDocuments**: Extracts metadata from loaded documents
3. **generateIntents**: LLM-powered intent inference with contextual analysis

## Setup Options

### Option 1: Basic Setup (Text files only)
```bash
# Minimum requirements
export OPENAI_API_KEY="your_openai_key"
```

### Option 2: Advanced Setup (All document types)
```bash
# For full document support via Unstructured API
export OPENAI_API_KEY="your_openai_key"
export UNSTRUCTURED_API_KEY="your_unstructured_key"
```

### Option 3: Local Server Setup (Enterprise/Offline)
```bash
# Run local Unstructured server
docker run -p 8000:8000 -d --rm --name unstructured-api \
  downloads.unstructured.io/unstructured-io/unstructured-api:latest \
  --port 8000 --host 0.0.0.0

# Configure environment
export OPENAI_API_KEY="your_openai_key"
export UNSTRUCTURED_SERVER_URL="http://localhost:8000"
```

## Usage

### Basic Analysis
```typescript
import { analyzeFolder } from './integration';

const result = await analyzeFolder('/path/to/documents');
console.log(`Success: ${result.success}`);
console.log(`Generated ${result.intents.length} intents`);
```

### Advanced Analysis
```typescript
import { analyzeFolder } from './integration';

const result = await analyzeFolder('/path/to/documents', {
  timeoutMs: 300000 // 5 minutes
});

if (result.success) {
  console.log(`📊 Generated ${result.intents.length} intents`);
  result.intents.forEach((intent, index) => {
    console.log(`${index + 1}. ${intent.payload}`);
    console.log(`   Confidence: ${(intent.confidence * 100).toFixed(1)}%`);
  });
}
```

### Environment Validation
```typescript
import { validateEnvironment, testSetup } from './integration';

// Check environment setup
const validation = validateEnvironment();
console.log('Environment valid:', validation.isValid);
console.log('Warnings:', validation.warnings);
console.log('Recommendations:', validation.recommendations);

// Test with sample folder
const test = await testSetup('/path/to/test/folder');
console.log('Test result:', test.success);
```

## Supported Document Types

### Basic Support (Always Available)
- **Code Files**: `.ts`, `.js`, `.tsx`, `.jsx`, `.py`, `.sql`
- **Data Files**: `.json`, `.yaml`, `.yml`, `.csv`, `.xml`
- **Documentation**: `.md`, `.txt`, `.html`, `.htm`

### Advanced Support (Requires Unstructured API/Server)
- **Documents**: `.pdf`, `.docx`, `.doc`, `.rtf`, `.odt`
- **Presentations**: `.pptx`, `.ppt`
- **Spreadsheets**: `.xlsx`, `.xls`
- **Email**: `.eml`, `.msg`
- **E-books**: `.epub`

## Intent Categories

The agent generates intents across 8 strategic categories:

- **📚 Learning**: Understanding concepts and functionality
- **🔍 Analysis**: Discovering patterns and insights
- **⚙️ Implementation**: Applying concepts and building solutions
- **🛠️ Troubleshooting**: Resolving issues and problems
- **📝 Documentation**: Creating and improving documentation
- **🔗 Integration**: Connecting systems and workflows
- **⚡ Optimization**: Improving performance and efficiency
- **✅ Compliance**: Meeting standards and requirements

## Output Structure

Each intent includes comprehensive metadata:

```typescript
interface InferredIntent {
  payload: string;                  // Intent description
  confidence: number;               // Confidence score (0.0-1.0)
}
```

## API Reference

### Main Functions

- `analyzeFolder(folderPath, options?)` - Complete analysis
- `getIntents(folderPath)` - Simple intent extraction
- `getAgentConfig()` - Get agent configuration
- `validateEnvironment()` - Check environment setup
- `testSetup(testFolderPath?)` - Test agent functionality

### Configuration Options

```typescript
interface AnalysisOptions {
  timeoutMs?: number;              // Processing timeout (default: 5 minutes)
}
```

## Workflow Details

### State Management
The agent uses LangGraph's `StateGraph` with `MemorySaver` for:
- **State Persistence**: Maintain workflow state across nodes
- **Error Recovery**: Graceful handling of node failures
- **Parallel Processing**: Efficient document loading and analysis

### Document Processing Pipeline
1. **Recursive Directory Scanning**: Intelligent filtering of relevant files
2. **Format Detection**: Automatic file type recognition
3. **Content Extraction**: Structured parsing with metadata
4. **Intent Generation**: LLM-powered inference with context
5. **Result Formatting**: Rich output with actionable recommendations

## Performance Characteristics

- **Scalability**: Handles large document collections (tested with 1000+ documents)
- **Timeout Protection**: Configurable processing timeouts
- **Memory Efficiency**: Streaming document processing
- **Error Resilience**: Graceful degradation with fallback strategies

## Limitations

- Large document collections may require significant processing time
- Complex document layouts may have parsing variations
- Intent quality depends on document content richness
- Unstructured API requires internet connection
- Processing timeout may be reached for very large collections

## Version History

- **v3.0.0**: Complete rewrite with LangChain UnstructuredDirectoryLoader
- **v2.0.0**: Unstructured API direct integration
- **v1.0.0**: Basic text file processing

## Dependencies

- `@langchain/community` - UnstructuredDirectoryLoader
- `@langchain/langgraph` - Workflow automation
- `@langchain/core` - Document abstractions
- `@langchain/openai` - LLM integration

## Contributing

The agent is designed for extensibility. Key extension points:
- Custom document loaders
- Additional intent categories
- Enhanced statistical analysis
- Custom output formatters