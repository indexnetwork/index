#!/usr/bin/env node
require('dotenv').config({ path: './.env' });


const { eq } = require('drizzle-orm');
const db = require('./src/lib/db').default;
const { users, intents, intentIndexes, indexMembers } = require('./src/lib/schema');
const { Events } = require('./src/lib/events');
const { initializeBrokers, triggerBrokersOnIntentCreated } = require('./src/agents/context_brokers/connector');
const { randomUUID } = require('crypto');

// Load environment variables

const INDEX_ID = '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c';

// Mock user data
const mockUsers = [
  {
    name: 'Alice Johnson',
    email: 'alice.johnson@example.com',
    intro: 'Product designer passionate about user experience and accessibility',
    avatar: '/avatars/users/alice.jpg'
  },
  {
    name: 'Bob Smith',
    email: 'bob.smith@example.com',
    intro: 'Full-stack developer and open source enthusiast',
    avatar: '/avatars/users/bob.jpg'
  },
  {
    name: 'Carol Lee',
    email: 'carol.lee@example.com',
    intro: 'Data scientist with a love for machine learning and statistics',
    avatar: '/avatars/users/carol.jpg'
  },
  {
    name: 'David Kim',
    email: 'david.kim@example.com',
    intro: 'Product manager focused on building impactful tech products',
    avatar: '/avatars/users/david.jpg'
  },
  {
    name: 'Eva Martinez',
    email: 'eva.martinez@example.com',
    intro: 'UX researcher passionate about accessibility and inclusion',
    avatar: '/avatars/users/eva.jpg'
  },
  {
    name: 'Frank Wu',
    email: 'frank.wu@example.com',
    intro: 'Cloud architect and DevOps advocate',
    avatar: '/avatars/users/frank.jpg'
  }
];

// 100 highly similar static intents focused on AI and machine learning partnerships
const staticIntents = [
  'Looking for AI researchers to collaborate on machine learning model optimization projects.',
  'Seeking AI researchers to partner on machine learning model optimization initiatives.',
  'Connecting with AI researchers for machine learning model optimization collaborations.',
  'Partnering with AI researchers on machine learning model optimization developments.',
  'Targeting AI researchers for machine learning model optimization partnerships.',
  'Reaching out to AI researchers about machine learning model optimization projects.',
  'Looking for AI specialists to collaborate on machine learning optimization research.',
  'Seeking AI specialists to partner on machine learning optimization initiatives.',
  'Connecting with AI specialists for machine learning optimization collaborations.',
  'Partnering with AI specialists on machine learning optimization developments.',
  'Targeting AI specialists for machine learning optimization partnerships.',
  'Reaching out to AI specialists about machine learning optimization projects.',
  'Looking for AI experts to collaborate on machine learning model research.',
  'Seeking AI experts to partner on machine learning model initiatives.',
  'Connecting with AI experts for machine learning model collaborations.',
  'Partnering with AI experts on machine learning model developments.',
  'Targeting AI experts for machine learning model partnerships.',
  'Reaching out to AI experts about machine learning model projects.',
  'Looking for machine learning researchers to collaborate on AI optimization projects.',
  'Seeking machine learning researchers to partner on AI optimization initiatives.',
  'Connecting with machine learning researchers for AI optimization collaborations.',
  'Partnering with machine learning researchers on AI optimization developments.',
  'Targeting machine learning researchers for AI optimization partnerships.',
  'Reaching out to machine learning researchers about AI optimization projects.',
  'Looking for machine learning specialists to collaborate on AI model projects.',
  'Seeking machine learning specialists to partner on AI model initiatives.',
  'Connecting with machine learning specialists for AI model collaborations.',
  'Partnering with machine learning specialists on AI model developments.',
  'Targeting machine learning specialists for AI model partnerships.',
  'Reaching out to machine learning specialists about AI model projects.',
  'Looking for machine learning experts to collaborate on AI research projects.',
  'Seeking machine learning experts to partner on AI research initiatives.',
  'Connecting with machine learning experts for AI research collaborations.',
  'Partnering with machine learning experts on AI research developments.',
  'Targeting machine learning experts for AI research partnerships.',
  'Reaching out to machine learning experts about AI research projects.',
  'Looking for AI researchers to collaborate on deep learning optimization projects.',
  'Seeking AI researchers to partner on deep learning optimization initiatives.',
  'Connecting with AI researchers for deep learning optimization collaborations.',
  'Partnering with AI researchers on deep learning optimization developments.',
  'Targeting AI researchers for deep learning optimization partnerships.',
  'Reaching out to AI researchers about deep learning optimization projects.',
  'Looking for AI specialists to collaborate on deep learning model projects.',
  'Seeking AI specialists to partner on deep learning model initiatives.',
  'Connecting with AI specialists for deep learning model collaborations.',
  'Partnering with AI specialists on deep learning model developments.',
  'Targeting AI specialists for deep learning model partnerships.',
  'Reaching out to AI specialists about deep learning model projects.',
  'Looking for AI experts to collaborate on neural network optimization projects.',
  'Seeking AI experts to partner on neural network optimization initiatives.',
  'Connecting with AI experts for neural network optimization collaborations.',
  'Partnering with AI experts on neural network optimization developments.',
  'Targeting AI experts for neural network optimization partnerships.',
  'Reaching out to AI experts about neural network optimization projects.',
  'Looking for deep learning researchers to collaborate on AI optimization projects.',
  'Seeking deep learning researchers to partner on AI optimization initiatives.',
  'Connecting with deep learning researchers for AI optimization collaborations.',
  'Partnering with deep learning researchers on AI optimization developments.',
  'Targeting deep learning researchers for AI optimization partnerships.',
  'Reaching out to deep learning researchers about AI optimization projects.',
  'Looking for deep learning specialists to collaborate on machine learning projects.',
  'Seeking deep learning specialists to partner on machine learning initiatives.',
  'Connecting with deep learning specialists for machine learning collaborations.',
  'Partnering with deep learning specialists on machine learning developments.',
  'Targeting deep learning specialists for machine learning partnerships.',
  'Reaching out to deep learning specialists about machine learning projects.',
  'Looking for deep learning experts to collaborate on AI model projects.',
  'Seeking deep learning experts to partner on AI model initiatives.',
  'Connecting with deep learning experts for AI model collaborations.',
  'Partnering with deep learning experts on AI model developments.',
  'Targeting deep learning experts for AI model partnerships.',
  'Reaching out to deep learning experts about AI model projects.',
  'Looking for neural network researchers to collaborate on optimization projects.',
  'Seeking neural network researchers to partner on optimization initiatives.',
  'Connecting with neural network researchers for optimization collaborations.',
  'Partnering with neural network researchers on optimization developments.',
  'Targeting neural network researchers for optimization partnerships.',
  'Reaching out to neural network researchers about optimization projects.',
  'Looking for neural network specialists to collaborate on AI projects.',
  'Seeking neural network specialists to partner on AI initiatives.',
  'Connecting with neural network specialists for AI collaborations.',
  'Partnering with neural network specialists on AI developments.',
  'Targeting neural network specialists for AI partnerships.',
  'Reaching out to neural network specialists about AI projects.',
  'Looking for neural network experts to collaborate on machine learning projects.',
  'Seeking neural network experts to partner on machine learning initiatives.',
  'Connecting with neural network experts for machine learning collaborations.',
  'Partnering with neural network experts on machine learning developments.',
  'Targeting neural network experts for machine learning partnerships.',
  'Reaching out to neural network experts about machine learning projects.',
  'Looking for AI researchers to collaborate on algorithm optimization projects.',
  'Seeking AI researchers to partner on algorithm optimization initiatives.',
  'Connecting with AI researchers for algorithm optimization collaborations.',
  'Partnering with AI researchers on algorithm optimization developments.',
  'Targeting AI researchers for algorithm optimization partnerships.',
  'Reaching out to AI researchers about algorithm optimization projects.',
  'Looking for AI specialists to collaborate on algorithm development projects.',
  'Seeking AI specialists to partner on algorithm development initiatives.',
  'Connecting with AI specialists for algorithm development collaborations.',
  'Partnering with AI specialists on algorithm development developments.',
  'Targeting AI specialists for algorithm development partnerships.',
  'Reaching out to AI specialists about algorithm development projects.',
  'Looking for AI experts to collaborate on computational optimization projects.',
  'Seeking AI experts to partner on computational optimization initiatives.',
  'Connecting with AI experts for computational optimization collaborations.',
  'Partnering with AI experts on computational optimization developments.',
  'Targeting AI experts for computational optimization partnerships.',
  'Reaching out to AI experts about computational optimization projects.'
];

// Template variables removed since we're using static intents

function getRandomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function getRandomStaticIntent() {
  return getRandomItem(staticIntents);
}

async function generateMockData() {
  console.log('Starting mock data generation...');
  
  try {
    // Initialize brokers first
    console.log('Initializing context brokers...');
    await initializeBrokers();
    console.log('✅ Context brokers initialized successfully');
    
    // Create users
    console.log('Creating 10 mock users...');
    const createdUsers = [];
    
    for (const userData of mockUsers) {
      try {
        const newUser = await db.insert(users).values({
          privyId: `mock_privy_${randomUUID()}`,
          email: userData.email,
          name: userData.name,
          intro: userData.intro,
          avatar: userData.avatar
        }).returning();
        
        createdUsers.push(newUser[0]);
        console.log(`Created user: ${userData.name} (${userData.email})`);
      } catch (error) {
        if (error.code === '23505') {
          // User already exists, find and use existing user
          const existingUser = await db.select().from(users).where(eq(users.email, userData.email)).limit(1);
          if (existingUser.length > 0) {
            createdUsers.push(existingUser[0]);
            console.log(`Using existing user: ${userData.name} (${userData.email})`);
          }
        } else {
          throw error;
        }
      }
    }
    
    // Add users as members of the specified index
    console.log(`Adding users as members of index ${INDEX_ID}...`);
    for (const user of createdUsers) {
      try {
        await db.insert(indexMembers).values({
          indexId: INDEX_ID,
          userId: user.id,
          permissions: ['can-read-intents', 'can-write-intents'],
          prompt: 'everything',
          autoAssign: true
        });
        console.log(`Added ${user.name} as member of index ${INDEX_ID}`);
      } catch (error) {
        if (error.code === '23505') {
          console.log(`${user.name} is already a member of index ${INDEX_ID}`);
        } else {
          console.warn(`Warning: Could not add ${user.name} to index: ${error.message}`);
        }
      }
    }
    
    // Create intents for each user
    console.log('Creating 2 intents per user...');
    const allIntents = [];
    
    for (const user of createdUsers) {
      console.log(`Creating intents for ${user.name}...`);
      
      for (let i = 0; i < 2; i++) {
        const payload = getRandomStaticIntent();
        
        const newIntent = await db.insert(intents).values({
          payload,
          summary: payload.length > 100 ? payload.substring(0, 97) + '...' : payload,
          userId: user.id
        }).returning();
        
        allIntents.push({
          intent: newIntent[0],
          userId: user.id,
          userName: user.name
        });
        
        // Associate intent with the index
        try {
          await db.insert(intentIndexes).values({
            intentId: newIntent[0].id,
            indexId: INDEX_ID
          });
          console.log(`✅ Associated intent with index: ${newIntent[0].id.substring(0, 8)}...`);
        } catch (error) {
          console.warn(`Warning: Could not associate intent with index: ${error.message}`);
        }
        
        // Trigger broker events for the intent
        try {
            await triggerBrokersOnIntentCreated(newIntent[0].id);
          console.log(`🎯 Triggered broker events for intent: ${newIntent[0].id.substring(0, 8)}...`);
        } catch (error) {
          console.warn(`Warning: Could not trigger broker events for intent: ${error.message}`);
        }
      }
    }
    
    console.log('\n=== Mock Data Generation Complete ===');
    console.log(`Created ${createdUsers.length} users`);
    console.log(`Created ${allIntents.length} intents`);
    console.log(`All intents associated with index: ${INDEX_ID}`);
    
    console.log('\n=== Sample Intents ===');
    for (let i = 0; i < Math.min(5, allIntents.length); i++) {
      const item = allIntents[i];
      console.log(`${item.userName}: "${item.intent.payload}"`);
    }
    
  } catch (error) {
    console.error('Error generating mock data:', error);
    process.exit(1);
  }
}

// Run the script
generateMockData();
