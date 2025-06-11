import { processIntent } from './workflow';

// Example intent objects based on the database schema
const sampleIntents = [
  {
    id: "550e8400-e29b-41d4-a716-446655440001",
    payload: "Looking to raise $2M Series A for our DeFi lending protocol. Need strategic partners with liquidity management expertise and regulatory knowledge.",
    status: "active",
    userId: "alice.consensys.eth",
    indexes: []
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440002", 
    payload: "Former Ethereum Foundation security engineer now available for consulting. 5+ years experience with smart contract audits, wallet security, and MEV protection.",
    status: "active",
    userId: "bob@consensys.net",
    indexes: []
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440003",
    payload: "ConsenSys Diligence seeking partnerships with early-stage DeFi protocols for comprehensive security audits. Special rates for portfolio companies launching on mainnet.",
    status: "active", 
    userId: "diana@consensys.net",
    indexes: []
  }
];

// Example usage of the ConsensysVibeStaker Network Manager Agent
async function main() {
  console.log("🚀 ConsensysVibeStaker Network Manager Agent - Intent Processing Demo\n");

  // Simulate processing each intent as if they were created sequentially
  for (let i = 0; i < sampleIntents.length; i++) {
    const currentIntent = sampleIntents[i];
    const existingIntents = sampleIntents.slice(0, i); // Previous intents as existing context
    
    console.log(`\n📋 Processing Intent ${i + 1}: ${currentIntent.payload.substring(0, 50)}...`);
    console.log(`🆔 ID: ${currentIntent.id}`);
    console.log(`👤 User ID: ${currentIntent.userId}`);
    console.log(`📝 Description: ${currentIntent.payload.substring(0, 100)}...`);
    console.log(`📊 Existing Intents for Comparison: ${existingIntents.length}`);
    console.log("⚡ Processing...\n");
    
    try {
      const result = await processIntent(currentIntent, existingIntents);
      console.log("📊 Agent Analysis:");
      console.log("─".repeat(70));
      console.log(result);
      console.log("─".repeat(70));
    } catch (error) {
      console.error(`❌ Error: ${error}`);
    }
    
    console.log("\n" + "=".repeat(80) + "\n");
    
    // Small delay to simulate real-world timing
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log("🎯 Demo complete! The agent analyzed each intent against existing ones to identify synergistic matches.");
  console.log("🔗 In a real implementation, this would be triggered automatically when intents are created/updated via the API.");
}

// Additional function to demonstrate analyzing a specific intent scenario
async function demonstrateSpecificScenario() {
  console.log("\n🎬 Demonstrating Specific High-Synergy Scenario\n");
  
  const newIntent = {
    id: "550e8400-e29b-41d4-a716-446655440004",
    payload: "Web3 startup needs experienced DevOps engineer for Kubernetes deployment and CI/CD pipeline setup. Budget: $5k/month for 6-month engagement.",
    status: "active",
    userId: "founder@startupx.com",
    indexes: []
  };

  const existingIntent = {
    id: "550e8400-e29b-41d4-a716-446655440005",
    payload: "Former ConsenSys DevOps engineer with 7+ years Kubernetes and AWS experience. Specializing in blockchain infrastructure and Web3 deployments. Available for contract work.",
    status: "active",
    userId: "alumni1@former-consensys.com",
    indexes: []
  };

  console.log("🎯 Perfect Match Scenario:");
  console.log(`New: ${newIntent.payload.substring(0, 50)}...`);
  console.log(`Existing: ${existingIntent.payload.substring(0, 50)}...`);
  console.log("Expected: High synergy match with automated staking\n");

  try {
    const result = await processIntent(newIntent, [existingIntent]);
    console.log("📊 Agent Analysis:");
    console.log("─".repeat(70));
    console.log(result);
    console.log("─".repeat(70));
  } catch (error) {
    console.error(`❌ Error: ${error}`);
  }
}

// Run the demo if this file is executed directly
if (require.main === module) {
  main()
    .then(() => demonstrateSpecificScenario())
    .catch(console.error);
}

export { main, demonstrateSpecificScenario }; 