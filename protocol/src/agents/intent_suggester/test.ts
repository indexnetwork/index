import { analyzeFolder, getIntents, getAgentConfig, validateEnvironment, testSetup } from './integration';
import { processFolder } from './workflow';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/**
 * Test suite for the Intent Suggester Agent (v3.0.0)
 * Tests the UnstructuredDirectoryLoader integration
 */

async function runTests() {
  console.log('🧪 Starting Intent Suggester Agent Test Suite (v3.0.0)');
  console.log('====================================================\n');

  const testResults: Array<{ name: string; passed: boolean; error?: string }> = [];

  // Test 1: Environment Validation
  console.log('📋 Test 1: Environment Validation');
  try {
    const validation = validateEnvironment();
    console.log(`✓ Environment validation completed`);
    console.log(`  - Valid: ${validation.isValid}`);
    console.log(`  - Warnings: ${validation.warnings.length}`);
    console.log(`  - Errors: ${validation.errors.length}`);
    console.log(`  - Recommendations: ${validation.recommendations.length}`);
    
    if (validation.warnings.length > 0) {
      console.log('  Warnings:', validation.warnings);
    }
    if (validation.errors.length > 0) {
      console.log('  Errors:', validation.errors);
    }
    
    testResults.push({ name: 'Environment Validation', passed: true });
  } catch (error) {
    console.log(`❌ Environment validation failed: ${error}`);
    testResults.push({ name: 'Environment Validation', passed: false, error: String(error) });
  }
  console.log();

  // Test 2: Agent Configuration
  console.log('⚙️  Test 2: Agent Configuration');
  try {
    const config = getAgentConfig();
    console.log(`✓ Agent configuration loaded`);
    console.log(`  - Name: ${config.name}`);
    console.log(`  - Version: ${config.version}`);
    console.log(`  - Basic file types: ${config.supportedFileTypes.basic.length}`);
    console.log(`  - Advanced file types: ${config.supportedFileTypes.advanced.length}`);
    
    testResults.push({ name: 'Agent Configuration', passed: true });
  } catch (error) {
    console.log(`❌ Agent configuration failed: ${error}`);
    testResults.push({ name: 'Agent Configuration', passed: false, error: String(error) });
  }
  console.log();

  // Test 3: Create Test Directory with Sample Files
  console.log('📁 Test 3: Create Test Documents');
  const testDir = path.join(os.tmpdir(), 'intent_suggester_test_' + Date.now());
  try {
    fs.mkdirSync(testDir, { recursive: true });

    // Create various test files
    const testFiles = [
      {
        name: 'README.md',
        content: '# Test Project\n\nThis is a test project for the Intent Suggester Agent.\n\n## Features\n- Document analysis\n- Intent generation\n- Statistical analysis'
      },
      {
        name: 'package.json',
        content: JSON.stringify({
          name: 'test-project',
          version: '1.0.0',
          description: 'Test project for intent inference',
          dependencies: {
            '@langchain/community': '^0.3.0',
            '@langchain/langgraph': '^0.2.0'
          }
        }, null, 2)
      },
      {
        name: 'src/index.ts',
        content: `// Main application entry point
export class TestApplication {
  constructor() {
    console.log('Test application initialized');
  }
  
  async processDocuments() {
    // Process document collection
    return { success: true };
  }
}`
      },
      {
        name: 'src/utils.py',
        content: `"""
Utility functions for document processing
"""

def analyze_content(content: str) -> dict:
    """Analyze document content and return insights"""
    return {
        'word_count': len(content.split()),
        'character_count': len(content),
        'type': 'text'
    }

class DocumentProcessor:
    def __init__(self):
        self.processed_count = 0
    
    def process(self, document):
        self.processed_count += 1
        return analyze_content(document)
`
      },
      {
        name: 'docs/api.md',
        content: `# API Documentation

## Endpoints

### POST /analyze
Analyze a document collection and generate intents.

**Request Body:**
\`\`\`json
{
  "folderPath": "/path/to/documents"
}
\`\`\`

**Response:**
\`\`\`json
{
  "success": true,
  "intents": [...]
}
\`\`\`
`
      },
      {
        name: 'config.yaml',
        content: `# Configuration file
app:
  name: intent-suggester-test
  version: "1.0.0"
  
processing:
  timeout: 300000
  max_documents: 1000
  
integrations:
  unstructured:
    enabled: true
    fallback: true
  langchain:
    version: "0.3.0"
`
      }
    ];

    // Create subdirectories
    fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'docs'), { recursive: true });

    // Write test files
    for (const file of testFiles) {
      const filePath = path.join(testDir, file.name);
      fs.writeFileSync(filePath, file.content, 'utf-8');
    }

    console.log(`✓ Created test directory: ${testDir}`);
    console.log(`  - Files created: ${testFiles.length}`);
    console.log(`  - Directory structure: src/, docs/, config files`);
    
    testResults.push({ name: 'Create Test Documents', passed: true });
  } catch (error) {
    console.log(`❌ Failed to create test documents: ${error}`);
    testResults.push({ name: 'Create Test Documents', passed: false, error: String(error) });
    return; // Can't continue without test data
  }
  console.log();

  // Test 4: Basic Intent Analysis
  console.log('🎯 Test 4: Basic Intent Analysis');
  try {
    const startTime = Date.now();
    const intents = await getIntents(testDir);
    
    const processingTime = Date.now() - startTime;
    
    console.log(`✓ Basic intent analysis completed in ${processingTime}ms`);
    console.log(`  - Intents generated: ${intents.length}`);
    
    if (intents.length > 0) {
      console.log(`  - Sample intent: "${intents[0].payload}"`);
      console.log(`  - Avg confidence: ${(intents.reduce((sum, i) => sum + i.confidence, 0) / intents.length * 100).toFixed(1)}%`);
    }
    
    testResults.push({ name: 'Basic Intent Analysis', passed: intents.length > 0 });
  } catch (error) {
    console.log(`❌ Basic intent analysis failed: ${error}`);
    testResults.push({ name: 'Basic Intent Analysis', passed: false, error: String(error) });
  }
  console.log();

  // Test 5: Full Analysis
  console.log('📊 Test 5: Full Analysis');
  try {
    const startTime = Date.now();
    const result = await analyzeFolder(testDir, { 
      timeoutMs: 60000 // 1 minute for test
    });
    const processingTime = Date.now() - startTime;
    
    console.log(`✓ Full analysis completed in ${processingTime}ms`);
    console.log(`  - Success: ${result.success}`);
    console.log(`  - Intents: ${result.intents.length}`);

    if (result.metadata) {
      console.log(`  - Processing time: ${result.metadata.processingTime}ms`);
      console.log(`  - Unstructured enabled: ${result.metadata.unstructuredEnabled}`);
      console.log(`  - Parsing method: ${result.metadata.parsingMethod}`);
    }
    
    testResults.push({ name: 'Full Analysis', passed: result.success && result.intents.length > 0 });
  } catch (error) {
    console.log(`❌ Full analysis failed: ${error}`);
    testResults.push({ name: 'Full Analysis', passed: false, error: String(error) });
  }
  console.log();

  // Test 6: Direct Workflow Test
  console.log('🔄 Test 6: Direct Workflow Test');
  try {
    const startTime = Date.now();
    const workflowResult = await processFolder(testDir);
    const processingTime = Date.now() - startTime;
    
    console.log(`✓ Direct workflow completed in ${processingTime}ms`);
    console.log(`  - Intents: ${workflowResult.intents.length}`);
    console.log(`  - Has output: ${!!workflowResult.output}`);
    
    testResults.push({ name: 'Direct Workflow Test', passed: workflowResult.intents.length > 0 });
  } catch (error) {
    console.log(`❌ Direct workflow failed: ${error}`);
    testResults.push({ name: 'Direct Workflow Test', passed: false, error: String(error) });
  }
  console.log();

  // Test 7: Agent Setup Test
  console.log('🔧 Test 7: Agent Setup Test');
  try {
    const setupResult = await testSetup(testDir);
    
    console.log(`✓ Agent setup test completed`);
    console.log(`  - Success: ${setupResult.success}`);
    console.log(`  - Message: ${setupResult.message}`);
    
    if (setupResult.details?.config) {
      console.log(`  - Config loaded: ${setupResult.details.config.name}`);
    }
    
    if (setupResult.details?.testResult) {
      console.log(`  - Test analysis: ${setupResult.details.testResult.success}`);
      console.log(`  - Test intents: ${setupResult.details.testResult.intents?.length || 0}`);
    }
    
    testResults.push({ name: 'Agent Setup Test', passed: setupResult.success });
  } catch (error) {
    console.log(`❌ Agent setup test failed: ${error}`);
    testResults.push({ name: 'Agent Setup Test', passed: false, error: String(error) });
  }
  console.log();

  // Test 8: Error Handling Test
  console.log('❌ Test 8: Error Handling');
  try {
    const invalidPath = '/nonexistent/path/that/should/not/exist';
    const errorResult = await analyzeFolder(invalidPath);
    
    const errorHandled = !errorResult.success && !!errorResult.error;
    console.log(`✓ Error handling test completed`);
    console.log(`  - Error properly handled: ${errorHandled}`);
    console.log(`  - Error message: ${errorResult.error}`);
    console.log(`  - Has metadata: ${!!errorResult.metadata}`);
    
    testResults.push({ name: 'Error Handling', passed: errorHandled });
  } catch (error) {
    console.log(`❌ Error handling test failed: ${error}`);
    testResults.push({ name: 'Error Handling', passed: false, error: String(error) });
  }
  console.log();

  // Cleanup
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
    console.log(`🧹 Cleaned up test directory: ${testDir}`);
  } catch (error) {
    console.log(`⚠️  Could not clean up test directory: ${error}`);
  }

  // Test Summary
  console.log('\n📈 TEST SUMMARY');
  console.log('===============');
  const passedTests = testResults.filter(t => t.passed).length;
  const totalTests = testResults.length;
  
  console.log(`Tests passed: ${passedTests}/${totalTests}`);
  console.log(`Success rate: ${(passedTests / totalTests * 100).toFixed(1)}%\n`);
  
  testResults.forEach(test => {
    const status = test.passed ? '✅' : '❌';
    console.log(`${status} ${test.name}`);
    if (!test.passed && test.error) {
      console.log(`   Error: ${test.error}`);
    }
  });

  if (passedTests === totalTests) {
    console.log('\n🎉 All tests passed! Intent Suggester Agent is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Check the errors above for details.');
  }
  
  return { passedTests, totalTests, testResults };
}

// Demo function
async function demoIntentSuggester(folderPath?: string) {
  console.log('🚀 Intent Suggester Agent Demo (v3.0.0)');
  console.log('=======================================\n');

  // Use current directory if no path provided
  const targetPath = folderPath || process.cwd();
  
  console.log(`📁 Analyzing folder: ${targetPath}\n`);

  try {
    // Show environment status
    console.log('🔍 Environment Check:');
    const validation = validateEnvironment();
    console.log(`  - Valid: ${validation.isValid}`);
    console.log(`  - Unstructured API: ${!!process.env.UNSTRUCTURED_API_KEY ? 'Available' : 'Not configured'}`);
    console.log(`  - Local server: ${!!process.env.UNSTRUCTURED_SERVER_URL ? 'Available' : 'Not configured'}`);
    console.log();

    // Perform analysis
    console.log('⚡ Starting analysis...');
    const startTime = Date.now();
    
    const result = await analyzeFolder(targetPath, {
      timeoutMs: 180000 // 3 minutes
    });
    
    const processingTime = Date.now() - startTime;
    
    if (result.success) {
      console.log(`✅ Analysis completed successfully in ${processingTime}ms\n`);
      
      // Show sample intents
      console.log(`🎯 Generated Intents (${result.intents.length} total):`);
      result.intents.slice(0, 5).forEach((intent, index) => {
          console.log(`  ${index + 1}. ${intent.payload}`);
          console.log(`     Confidence: ${(intent.confidence * 100).toFixed(1)}%`);
          console.log();
        });

      // Show metadata
      if (result.metadata) {
        console.log('🔧 Processing Metadata:');
        console.log(`  - Processing Time: ${result.metadata.processingTime}ms`);
        console.log(`  - Unstructured Enabled: ${result.metadata.unstructuredEnabled}`);
        console.log(`  - Parsing Method: ${result.metadata.parsingMethod}`);
        console.log();
      }

    } else {
      console.log(`❌ Analysis failed: ${result.error}`);
    }

  } catch (error) {
    console.log(`💥 Demo failed with error: ${error}`);
  }
}

// Export test functions
export { runTests, demoIntentSuggester };

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
} 