import { runNetworkManager } from './workflow';

// Example usage of the ConsensysVibeStaker Network Manager Agent
async function main() {
  console.log("🚀 ConsensysVibeStaker Network Manager Agent - Demo\n");

  // Example scenarios to test
  const scenarios = [
    {
      name: "Founder Fundraising Intent",
      input: "alice.consensys.eth is looking to raise $2M for their DeFi protocol and needs strategic partners with liquidity management expertise"
    },
    {
      name: "New Hire with Relevant Background", 
      input: "Bob just joined MetaMask team as Lead Security Engineer. Previously worked at Ethereum Foundation on wallet security protocols"
    },
    {
      name: "Partnership Conversation",
      input: "ConsenSys Diligence wants to partner with portfolio companies for smart contract audits. Looking for teams launching on mainnet in Q2"
    },
    {
      name: "Multi-party Synergy",
      input: "Three signals: 1) startupx.eth needs DevOps expertise, 2) former consensys engineer now freelancing with k8s skills, 3) web3corp.eth building similar infrastructure"
    }
  ];

  for (const scenario of scenarios) {
    console.log(`\n📋 Scenario: ${scenario.name}`);
    console.log(`🔍 Input: ${scenario.input}`);
    console.log("⚡ Processing...\n");
    
    try {
      const result = await runNetworkManager(scenario.input);
      console.log("📊 Agent Output:");
      console.log("─".repeat(50));
      console.log(result);
      console.log("─".repeat(50));
    } catch (error) {
      console.error(`❌ Error: ${error}`);
    }
    
    console.log("\n" + "=".repeat(80) + "\n");
  }
}

// Run the demo if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { main }; 