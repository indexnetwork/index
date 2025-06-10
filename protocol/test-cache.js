// Simple test script for our L1 cache implementation
const axios = require('axios');

const BASE_URL = 'http://localhost:8000';

async function testCache() {
  try {
    console.log('🧪 Testing L1 Cache Implementation...\n');
    
    // Test getting suggestions without cache (should be slow)
    console.log('1. Testing first request (should generate suggestions)...');
    const start1 = Date.now();
    const response1 = await axios.get(`${BASE_URL}/indexes/test-id/suggested_intents`, {
      headers: { 'Authorization': 'Bearer test-token' }
    });
    const time1 = Date.now() - start1;
    console.log(`   First request: ${time1}ms, fromCache: ${response1.data.fromCache}, processingTime: ${response1.data.processingTime}ms`);
    console.log(`   Found ${response1.data.intents.length} suggestions\n`);
    
    // Test getting suggestions with cache (should be fast)
    console.log('2. Testing second request (should use cache)...');
    const start2 = Date.now();
    const response2 = await axios.get(`${BASE_URL}/indexes/test-id/suggested_intents`, {
      headers: { 'Authorization': 'Bearer test-token' }
    });
    const time2 = Date.now() - start2;
    console.log(`   Second request: ${time2}ms, fromCache: ${response2.data.fromCache}, processingTime: ${response2.data.processingTime}ms`);
    console.log(`   Found ${response2.data.intents.length} suggestions\n`);
    
    // Verify cache is working
    if (response2.data.fromCache && time2 < time1) {
      console.log('✅ Cache is working correctly!');
      console.log(`   Performance improvement: ${Math.round((time1 - time2) / time1 * 100)}% faster`);
    } else {
      console.log('❌ Cache might not be working as expected');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Error:', error.response.data);
    }
  }
}

// Test cache invalidation
async function testCacheInvalidation() {
  try {
    console.log('\n🧪 Testing Cache Invalidation...\n');
    
    // Upload a file (should invalidate cache)
    console.log('1. Testing file upload (should invalidate cache)...');
    // This would need a real file upload implementation
    console.log('   Simulating file upload...\n');
    
    // Request suggestions again (should regenerate)
    console.log('2. Testing request after cache invalidation...');
    const start = Date.now();
    const response = await axios.get(`${BASE_URL}/indexes/test-id/suggested_intents`, {
      headers: { 'Authorization': 'Bearer test-token' }
    });
    const time = Date.now() - start;
    console.log(`   Request after invalidation: ${time}ms, fromCache: ${response.data.fromCache}, processingTime: ${response.data.processingTime}ms`);
    
    if (!response.data.fromCache) {
      console.log('✅ Cache invalidation is working correctly!');
    } else {
      console.log('❌ Cache invalidation might not be working');
    }
    
  } catch (error) {
    console.error('❌ Cache invalidation test failed:', error.message);
  }
}

// Run tests
async function runTests() {
  await testCache();
  // await testCacheInvalidation(); // Uncomment when ready to test invalidation
}

runTests(); 