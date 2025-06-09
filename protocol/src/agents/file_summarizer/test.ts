/**
 * File Summarizer Test
 */

import { summarizeAndSaveFile, isFileSupported } from './index';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function testFileSummarizer() {
  console.log('🧪 Testing File Summarizer Agent...\n');

  // Test isFileSupported function
  console.log('📋 Testing file support detection:');
  console.log('  - test.txt:', isFileSupported('test.txt'));
  console.log('  - document.pdf:', isFileSupported('document.pdf'));
  console.log('  - video.mp4:', isFileSupported('video.mp4'));
  console.log('  - audio.mp3:', isFileSupported('audio.mp3'));
  console.log('  - archive.zip:', isFileSupported('archive.zip'));
  console.log();

  // Create a test text file
  const tempDir = os.tmpdir();
  const testFilePath = path.join(tempDir, 'test-document.txt');
  const testFileId = 'test-file-123';
  const outputDir = path.join(tempDir, 'summaries');

  const testContent = `# Test Document

This is a test document for the file summarizer agent.

## Introduction
This document contains sample text to test the summarization functionality.

## Key Points
- Point 1: File processing works correctly
- Point 2: Summary generation is functional
- Point 3: Output saving is operational

## Conclusion
The file summarizer should be able to process this content and generate a meaningful summary.`;

  try {
    // Write test file
    fs.writeFileSync(testFilePath, testContent, 'utf8');
    console.log('📄 Created test file:', testFilePath);

    // Test summarization
    console.log('🔄 Testing file summarization...');
    const result = await summarizeAndSaveFile(testFilePath, testFileId, outputDir);

    if (result.success) {
      console.log('✅ Summarization successful!');
      console.log('📋 Summary:', result.summary?.summary?.substring(0, 200) + '...');
      
      // Check if summary file was created
      const summaryPath = path.join(outputDir, `${testFileId}.summary`);
      if (fs.existsSync(summaryPath)) {
        console.log('💾 Summary file created successfully:', summaryPath);
        const savedSummary = fs.readFileSync(summaryPath, 'utf8');
        console.log('📄 Saved summary length:', savedSummary.length, 'characters');
      } else {
        console.log('❌ Summary file was not created');
      }
    } else {
      console.log('❌ Summarization failed:', result.error);
    }

    // Test with missing file
    console.log('\n🧪 Testing with missing file...');
    const missingResult = await summarizeAndSaveFile('/nonexistent/file.txt', 'missing-123', outputDir);
    if (!missingResult.success) {
      console.log('✅ Correctly handled missing file:', missingResult.error);
    } else {
      console.log('❌ Should have failed for missing file');
    }

    console.log('\n🎉 File Summarizer test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
      const summaryPath = path.join(outputDir, `${testFileId}.summary`);
      if (fs.existsSync(summaryPath)) {
        fs.unlinkSync(summaryPath);
      }
      if (fs.existsSync(outputDir)) {
        fs.rmdirSync(outputDir);
      }
    } catch (cleanupError) {
      console.warn('⚠️ Cleanup error:', cleanupError);
    }
  }
}

// Run test if called directly
if (require.main === module) {
  testFileSummarizer().catch(console.error);
}

export { testFileSummarizer }; 