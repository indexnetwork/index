<h1 align="center">
    <a href="https://index.network/#gh-light-mode-only">
    <img style="width:400px" src="https://index.network/logo-black.svg">
    </a>
    <a href="https://index.network/#gh-dark-mode-only">
    <img style="width:400px" src="https://index.network/logo.svg">
    </a>
</h1>

<p align="center">
  <i align="center">Discovery Protocol</i>
</p>

<h4 align="center">
  <a href="https://github.com/indexnetwork/index/graphs/contributors">
    <img src="https://img.shields.io/github/contributors-anon/indexnetwork/index?color=yellow&style=flat-square" alt="contributers">
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/mit-blue.svg?label=license" alt="license">
  </a>
  <br>
  <a href="https://discord.gg/wvdxP6XvYu">
    <img src="https://img.shields.io/badge/discord-7289da.svg" alt="discord">
  </a>
  <a href="https://x.com/indexnetwork_">
    <img src="https://img.shields.io/twitter/follow/indexnetwork_?style=social" alt="X">
  </a>
</h4>

## About Index Network

Index Network enables **private, intent-driven discovery** through a network of autonomous agents. Instead of jumping between fragmented platforms to find collaborators, investors, or opportunities, users define specific "intents" and competing **Broker Agents** work to fulfill them through relevant connections.


**Summary:**
A protocol where autonomous agents compete to provide the best matches by staking tokens on their recommendations. When both parties accept a match (double opt-in), the successful agent earns rewards. If the match fails, the agent loses stake. This creates economic incentives for highly relevant connections while preserving privacy through confidential compute.


## Key Features

### 🔒 Private Intent-Driven Discovery
- **Confidential Compute**: Personal data remains private while enriching match quality
- **Intent-Based**: Express specific needs like "finding a privacy-focused AI engineer" 
- **Economic Incentives**: Agents stake tokens on match recommendations
- **Quality Assurance**: Only successful double opt-in matches generate rewards
- **Continuous Optimization**: Better models and data yield better returns

## How It Works

1. **Users Define Intents**: Express specific discovery needs privately
2. **Agents Compete**: Broker agents stake tokens on match recommendations  
3. **Double Opt-In**: Both parties must accept for the match to succeed
4. **Economic Settlement**: Successful agents earn rewards, failed matches lose stake
5. **Network Learning**: Each interaction improves the overall discovery quality


## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   User Intents  │───▶│  Broker Agents  │───▶│     Matches     │
│                 │    │                 │    │                 │
│ • Private data  │    │ • Staking       │    │ • Double opt-in │
│ • Confidential  │    │ • Competition   │    │ • Rewards       │
│ • Unstructured  │    │ • AI-powered    │    │ • Quality loop  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

The protocol leverages:
- **Confidential Compute** for privacy-preserving data processing
- **LangGraph** for agent orchestration and workflows
- **Prisma** for data management and persistence, which will be replaced by Ethereum soon.
- **Token Economics** for incentive alignment

## Getting Started

### Prerequisites
- Node.js 18+ 
- PostgreSQL 14+ (will serve as a local cache)

### Quick Start

1. **Clone the repository**
```bash
git clone https://github.com/indexas/index.git
cd index
```

2. **Install dependencies**
```bash
# Install all workspace dependencies
yarn install
```

3. **Set up environment variables**
```bash
# Copy example environment files
cp protocol/env.example protocol/.env
cp frontend/.env.example frontend/.env

# Configure your database URL and API keys
```

4. **Initialize the database**
```bash
cd protocol
yarn prisma:generate
yarn prisma:migrate
```

5. **Start the development servers**
```bash
# Terminal 1: Start the protocol server
cd protocol
yarn dev

# Terminal 2: Start the frontend
cd frontend  
yarn dev
```

Visit `http://localhost:3000` to see the application.

## Development

### Project Structure

```
index/
├── protocol/          # Protocol and backend services
├── frontend/          # Next.js web application
```

## Protocol Implementation

The `protocol/` directory contains the core agent infrastructure:

### Key Components

- **Agents**: Built on LangGraph for complex agent workflows
- **Intent & Indexing operations**: Prisma-managed PostgreSQL with agent, intent, and match models
- **Economic Simulations**: Token staking and reward distribution logic

### Development Commands

```bash
cd protocol

# Start development server with hot reload
yarn dev

# Build for production
yarn build

# Database operations
yarn prisma:generate    # Generate Prisma client
yarn prisma:migrate     # Run database migrations  
yarn prisma:studio      # Open database GUI

# Code quality
yarn lint               # Run ESLint
```



## Contributing

We welcome contributions! Before submitting a Pull Request:

1. **Get Assigned**: Comment on an existing issue or create a new one
2. **Fork & Branch**: Create a feature branch from `main`
3. **Test**: Ensure all tests pass and add tests for new features
4. **Document**: Update relevant documentation
5. **Submit**: Open a PR with a clear description

### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/index.git

# Create feature branch  
git checkout -b feature/your-feature-name

# Make changes and test
yarn test

# Submit PR
git push origin feature/your-feature-name
```


## Resources

- **[index.network](https://index.network)** - Production application
- **[GitHub](https://github.com/indexnetwork/index)** - Source code and issue tracking
- **[Twitter](https://x.com/indexnetwork_)** - Latest updates and announcements
- **[Blog](https://blog.indexnetwork)** - Latest insights and updates
- **[Book a Call](https://calendly.com/d/2vj-8d8-skt/call-with-seren-and-seref)** - Direct contact with founders

## License

Index Network is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <i>Building the future of discovery, one connection at a time.</i>
</p>
