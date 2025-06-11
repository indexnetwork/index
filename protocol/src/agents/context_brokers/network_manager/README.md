# ConsensysVibeStaker Network Manager Agent

A LangGraph-powered AI agent that automatically detects ecosystem synergies and stakes on high-conviction matches between ConsenSys network participants.

## Overview

The Network Manager Agent increases network-wide synergy, reduces cold starts, and accelerates coordination between known-value players in the ConsenSys ecosystem by:

- **Detecting intents** from audience member activities (fundraising, hiring, partnerships)
- **Matching compatible activities** and complementary needs
- **Evaluating synergy potential** with semantic analysis
- **Making staking decisions** on high-conviction matches
- **Executing automated stakes** to signal ecosystem conviction

## Architecture

### LangGraph Workflow
The agent uses a streamlined LangGraph workflow with semantic LLM analysis:

```
Input → Network Analyzer → Output
```

### State Management
- **Input**: Raw activity/intent data from network participants
- **Output**: Comprehensive analysis with stake execution summary

### Core Components

1. **Intent Detection**: Identifies fundraising, hiring, and partnership signals
2. **Pattern Matching**: Finds compatible activities between users
3. **Synergy Evaluation**: Assesses ecosystem benefit potential  
4. **Stake Execution**: Commits resources to high-conviction matches

## Configuration

### Agent Specification (`agent.json`)
- **Name**: `network_manager`
- **Role**: `NETWORK_COORDINATOR`
- **Triggers**: Founder raise intents, ecosystem hires, partnership conversations
- **Thresholds**: Synergy (0.7), Conviction (0.8), Max daily stakes (50)

### Audience Data
Minimal identifier-only datasets:
- **ConsenSys Employees** (`consensys_employees.json`)
- **Portfolio Companies** (`portfolio_companies.json`)  
- **Alumni Network** (`alumni_network.json`)

Supported identifier types:
- ETH wallet addresses
- DID (Decentralized Identifiers)
- ENS names
- Email addresses

## Usage

### Basic Execution
```typescript
import { runNetworkManager } from './workflow';

const result = await runNetworkManager(
  "alice.consensys.eth seeking $2M raise for DeFi protocol, needs liquidity expertise"
);
console.log(result);
```

### Example Scenarios
Run the demo with various scenarios:
```bash
npm run dev src/agents/network_manager/example.ts
```

### Integration
```typescript
import { createNetworkManagerWorkflow } from './workflow';

const workflow = createNetworkManagerWorkflow();
const app = workflow.compile();

const result = await app.invoke({ 
  input: "your network activity input" 
});
```

## Dependencies

- `@langchain/langgraph`: ^0.2.73
- `@langchain/openai`: ^0.5.11
- `@langchain/core`: ^0.3.57

## Environment Variables

```bash
OPENAI_API_KEY=your_openai_api_key
```

## File Structure

```
src/agents/network_manager/
├── agent.json              # Agent configuration
├── workflow.ts             # LangGraph implementation
├── example.ts              # Usage examples
├── README.md              # This file
└── data/
    ├── consensys_employees.json
    ├── portfolio_companies.json
    └── alumni_network.json
```

## Features

### Minimal & Focused
- Core identifiers only (no metadata bloat)
- Semantic LLM technologies throughout
- Clean LangGraph workflow patterns

### Automated Staking
- Threshold-based decision making
- Conviction level tracking
- Comprehensive execution reporting

### Ecosystem Synergy
- Cross-audience pattern matching
- Network effect amplification
- Cold start problem mitigation

## Example Output

```
ConsensysVibeStaker Network Manager - Analysis Complete:

Intent Detection:
- Fundraising signal from alice.consensys.eth ($2M DeFi protocol)
- Expertise requirement: liquidity management

Pattern Matching:
- Compatible match found with bob@consensys.net (DeFi liquidity specialist)
- Synergy score: 0.85

Execution Summary:
✅ Staked 75 on alice.consensys.eth ↔ bob@consensys.net
   Conviction: 85.0%
   Reasoning: High synergy DeFi + liquidity expertise match
```

## License

Part of the Index Protocol ecosystem. 