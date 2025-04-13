'use client';

import React, { createContext, useContext, useState } from 'react';
import { Backer, Connection, Intent } from '@/types';


const reputationAgents = [
  {
    "name": "0xScore Wallet reputation scoring agent",
    "avatar": "/avatars/agents/0xscore.svg"
  },
  {
    "name": "Aspecta Builder profile enrichment agent",
    "avatar": "/avatars/agents/aspecta.svg"
  },
  {
    "name": "Gitcoin Ecosystem grants participation agent",
    "avatar": "/avatars/agents/gitcoin.svg"
  },
  {
    "name": "Hapi Personhood and trust score agent",
    "avatar": "/avatars/agents/hapi.svg"
  },
  {
    "name": "Nomis Wallet reputation personalization agent",
    "avatar": "/avatars/agents/nomis.svg"
  },
  {
    "name": "Orange Protocol Reputation minting and trust proofs agent",
    "avatar": "/avatars/agents/orange.svg"
  },
  {
    "name": "Passport XYZ Wallet participation scoring agent",
    "avatar": "/avatars/agents/passport.svg"
  },
  {
    "name": "Privado wallet insights agent",
    "avatar": "/avatars/agents/privado.svg"
  },
  {
    "name": "ReputeX Cross-chain reputation scoring agent",
    "avatar": "/avatars/agents/reputex.svg"
  },
  {
    "name": "RubyScore Layer 2 wallet ranking agent",
    "avatar": "/avatars/agents/rubyscore.svg"
  },
  {
    "name": "Trusta Sybil resistance verification agent",
    "avatar": "/avatars/agents/trusta.svg"
  },
  {
    "name": "zkPass identity verification agent",
    "avatar": "/avatars/agents/zkpass.svg"
  }
]

interface IntentContextType {
  intents: Intent[];
  getIntentById: (id: number) => Intent | undefined;
  getConnectionsByIntentId: (intentId: number) => Connection[];
  updateIntentStatus: (id: number, status: 'open' | 'closed') => void;
  handleConnectionAction: (intentId: number, connectionId: number, action: 'accept' | 'decline') => void;
  addBacker: (intentId: number, connectionId: number, backer: Backer) => void;
  removeBacker: (intentId: number, connectionId: number, backerName: string) => void;
}

const IntentContext = createContext<IntentContextType | undefined>(undefined);

// Mock data


const mockIntents: Intent[] = [
  {
    id: 1,
    title: "Looking for a founding engineer experienced in privacy-preserving AI and confidential compute.",
    status: "open",
    pendingConnections: 3,
    confirmedConnections: 2,
    totalConnections: 5,
    connections: [
      {
        id: 1,
        name: 'Sarah Chen',
        role: 'Senior AI Engineer',
        avatar: 'https://i.pravatar.cc/150?img=1',
        matchReason: 'Sarah Chen brings deep expertise in privacy-preserving ML and federated learning, crucial for our needs. She has hands-on experience building systems that protect data privacy while enabling decentralized model training. At DeepMind, she led confidential computing projects, developing secure computation protocols and managing complex initiatives successfully. Her work is widely recognized, with numerous publications in top conferences. Sarah\'s unique blend of technical skill and leadership makes her an excellent fit for our founding engineer role, driving secure and innovative AI solutions.',
        createdAt: '2024-04-11',
        status: 'potential',
        stakeDistribution: {
          reputation: 0.87,
          relevancy: 0.92,
          urgency: 0.7,
          intentHistory: 0.6
        },
        backers: [
          {
            name: reputationAgents[0].name,
            feedback: "Identified Sarah as a strong generalist match for founder roles based on multi-domain technical expertise.",
            successRate: 0.82,
            stakedAmount: 400,
            avatar: reputationAgents[0].avatar,
            role: "Discovery Router"
          },
          {
            name: reputationAgents[1].name,
            feedback: "Detected Sarah's federated learning work and previous confidential compute leadership aligns directly with the intent.",
            successRate: 0.91,
            stakedAmount: 500,
            avatar: reputationAgents[1].avatar,
            role: "Relevancy Agent"
          },
          {
            name: reputationAgents[2].name,
            feedback: "Validated private project history indicating a long-standing focus on privacy-enhancing technologies.",
            successRate: 0.75,
            stakedAmount: 300,
            avatar: reputationAgents[2].avatar,
            role: "Private Data Enrichment"
          },
          {
            name: reputationAgents[3].name,
            feedback: "Higher reward pool attached to this intent prompted prioritization of Sarah's candidacy.",
            successRate: 0.95,
            stakedAmount: 700,
            avatar: reputationAgents[3].avatar,
            role: "Intent Liquidity"
          }
        ]
      },
      {
        id: 2,
        name: 'Alexei Morozov',
        role: 'Cryptography Researcher',
        avatar: 'https://i.pravatar.cc/150?img=2',
        matchReason: 'PhD in cryptography with a focus on zk-SNARKs, contributor to open-source privacy protocols.',
        createdAt: '2024-04-10',
        status: 'potential',
        stakeDistribution: {
          reputation: 0.9,
          relevancy: 0.88,
          urgency: 0.65,
          intentHistory: 0.55
        },
        backers: [
          {
            name: reputationAgents[4].name,
            feedback: "Spotted Alexei's zk-SNARK contributions and active involvement in open-source privacy tools.",
            successRate: 0.93,
            stakedAmount: 550,
            avatar: reputationAgents[4].avatar,
            role: "Relevancy Agent"
          },
          {
            name: reputationAgents[5].name,
            feedback: "Alexei's builder profile reflects deep cryptographic specialization relevant to this intent.",
            successRate: 0.88,
            stakedAmount: 400,
            avatar: reputationAgents[5].avatar,
            role: "Relevancy Agent"
          },
          {
            name: reputationAgents[6].name,
            feedback: "High trust score based on cross-chain reputation and cryptography-focused projects.",
            successRate: 0.85,
            stakedAmount: 420,
            avatar: reputationAgents[6].avatar,
            role: "Reputation Agent"
          },
          {
            name: reputationAgents[7].name,
            feedback: "Intent's reward pool attracted attention to candidates with cryptography pedigree.",
            successRate: 0.96,
            stakedAmount: 750,
            avatar: reputationAgents[7].avatar,
            role: "Intent Liquidity"
          }
        ]
      },
      {
        id: 3,
        name: 'Fatima El Idrissi',
        role: 'Blockchain Protocol Engineer',
        avatar: 'https://i.pravatar.cc/150?img=3',
        matchReason: 'Worked on zkRollup architecture at Consensys Linea, active in privacy DAO initiatives.',
        createdAt: '2024-04-09',
        status: 'potential',
        stakeDistribution: {
          reputation: 0.88,
          relevancy: 0.9,
          urgency: 0.72,
          intentHistory: 0.68
        },
        backers: [
          {
            name: reputationAgents[8].name,
            feedback: "Confirmed Fatima's active role in Linea zkRollup development and community participation.",
            successRate: 0.92,
            stakedAmount: 530,
            avatar: reputationAgents[8].avatar,
            role: "Ecosystem Agent"
          },
          {
            name: reputationAgents[9].name,
            feedback: "Recognized Fatima's leadership in privacy-first DAO technical working groups.",
            successRate: 0.9,
            stakedAmount: 480,
            avatar: reputationAgents[9].avatar,
            role: "Relevancy Agent"
          },
          {
            name: reputationAgents[10].name,
            feedback: "Builder data shows clear zkRollup specialization and public contributions.",
            successRate: 0.87,
            stakedAmount: 410,
            avatar: reputationAgents[10].avatar,
            role: "Relevancy Agent"
          },
          {
            name: reputationAgents[11].name,
            feedback: "Fatima maintains a high multi-chain reputation within Consensys-aligned protocols.",
            successRate: 0.9,
            stakedAmount: 450,
            avatar: reputationAgents[11].avatar,
            role: "Reputation Agent"
          }
        ]
      }
    ]
  }
];


const IntentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [intents, setIntents] = useState<Intent[]>(mockIntents);

  const getIntentById = (id: number) => {
    return intents.find(intent => intent.id === id);
  };

  const getConnectionsByIntentId = (intentId: number) => {
    const intent = getIntentById(intentId);
    return intent?.connections || [];
  };

  const updateIntentStatus = (id: number, status: 'open' | 'closed') => {
    setIntents(prev => prev.map(intent => 
      intent.id === id ? { ...intent, status } : intent
    ));
  };

  const handleConnectionAction = (intentId: number, connectionId: number, action: 'accept' | 'decline') => {
    setIntents(prev => prev.map(intent => {
      if (intent.id === intentId) {
        const updatedConnections = intent.connections.map(connection => {
          if (connection.id === connectionId) {
            return {
              ...connection,
              status: action === 'accept' ? 'pending' : 'declined'
            };
          }
          return connection;
        });
        return {
          ...intent,
          connections: updatedConnections,
          pendingConnections: action === 'accept' ? intent.pendingConnections + 1 : intent.pendingConnections,
          confirmedConnections: action === 'accept' ? intent.confirmedConnections : intent.confirmedConnections - 1
        };
      }
      return intent;
    }));
  };

  const addBacker = (intentId: number, connectionId: number, backer: Backer) => {
    setIntents(prev => prev.map(intent => {
      if (intent.id === intentId) {
        return {
          ...intent,
          connections: intent.connections.map(connection => {
            if (connection.id === connectionId) {
              return {
                ...connection,
                backers: [...connection.backers, backer]
              };
            }
            return connection;
          })
        };
      }
      return intent;
    }));
  };

  const removeBacker = (intentId: number, connectionId: number, backerName: string) => {
    setIntents(prev => prev.map(intent => {
      if (intent.id === intentId) {
        return {
          ...intent,
          connections: intent.connections.map(connection => {
            if (connection.id === connectionId) {
              return {
                ...connection,
                backers: connection.backers.filter(backer => backer.name !== backerName)
              };
            }
            return connection;
          })
        };
      }
      return intent;
    }));
  };

  return (
    <IntentContext.Provider
      value={{
        intents,
        getIntentById,
        getConnectionsByIntentId,
        updateIntentStatus,
        handleConnectionAction,
        addBacker,
        removeBacker,
      }}
    >
      {children}
    </IntentContext.Provider>
  );
};

export { IntentProvider };
export function useIntent() {
  const context = useContext(IntentContext);
  if (context === undefined) {
    throw new Error('useIntent must be used within an IntentProvider');
  }
  return context;
} 