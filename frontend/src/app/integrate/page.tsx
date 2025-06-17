"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check, ChevronRight, ChevronDown, FileText } from "lucide-react";
import ClientLayout from "@/components/ClientLayout";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ConfigureModal from "@/components/modals/ConfigureModal";
import { MCP } from '@lobehub/icons';
import Image from "next/image";

interface ComponentConfig {
  id: string;
  name: string;
  description: string;
  previewImage: string;
  caseStudies: {
    title: string;
    description: string;
    link: string;
  }[];
  examples: {
    title: string;
    description: string;
    code: string;
    preview?: React.ReactNode;
  }[];
}

interface ConversationalConfig {
  id: string;
  name: string;
  description: string;
  previewImage: string;
  caseStudies: {
    title: string;
    description: string;
    link: string;
  }[];
  examples: {
    title: string;
    description: string;
    code: string;
    preview?: React.ReactNode;
  }[];
}

const conversationalIntegrations: ConversationalConfig[] = [
  {
    id: "matchmakeragent",
    name: "Matchmaker",
    description: "AI-powered matchmaking agent that provides intelligent match suggestions and facilitates connections.",
    previewImage: "/integrate/agent.gif",
    caseStudies: [
      {
        title: "Professional Network",
        description: "LinkedIn's AI matchmaker for business partnerships",
        link: "#case-study-linkedin"
      },
      {
        title: "Event Networking",
        description: "Conference platforms using MatchmakerAgent for attendee connections",
        link: "#case-study-events"
      }
    ],
    examples: [
      {
        title: "Intent Inferring",
        description: "Automatically infer intents from Slack conversations in the background",
        code: `import { IndexSDK } from '@index/sdk';
import { WebClient } from '@slack/web-api';

// Initialize Slack client and Index SDK
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const index = new IndexSDK({
  apiKey: process.env.INDEX_API_KEY
});

// Background job to monitor channels for collaboration intents
async function monitorSlackForIntents() {
  const channels = ['#general', '#collaboration', '#projects'];
  
  for (const channel of channels) {
    const result = await slack.conversations.history({
      channel: channel,
      limit: 50
    });
    
    for (const message of result.messages) {
      // Use AI to detect collaboration intents
      const hasIntent = await detectCollaborationIntent(message.text);
      
      if (hasIntent) {
        await index.intents.create({
          payload: message.text,
          userId: message.user,
          status: 'active',
          source: 'slack',
          channel: channel
        });
      }
    }
  }
}

async function detectCollaborationIntent(text) {
  // Keywords that suggest collaboration intent
  const intentKeywords = [
    'looking for', 'need help', 'seeking', 'collaborate',
    'partner', 'work together', 'join forces', 'team up'
  ];
  
  return intentKeywords.some(keyword => 
    text.toLowerCase().includes(keyword)
  );
}

// Run every 15 minutes
setInterval(monitorSlackForIntents, 15 * 60 * 1000);`
      },
      {
        title: "Offering Connections",
        description: "Proactively suggest matches and facilitate connections between users",
        code: `import { IndexSDK } from '@index/sdk';
import { WebClient } from '@slack/web-api';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const index = new IndexSDK({
  apiKey: process.env.INDEX_API_KEY
});

// Find and offer connections based on matching intents
async function offerConnections() {
  // Get all active intents
  const intents = await index.intents.list({
    status: 'active',
    limit: 100
  });
  
  // Find potential matches
  for (const intent of intents) {
    const matches = await index.intents.findMatches(intent.id, {
      limit: 3,
      confidence: 0.7
    });
    
    if (matches.length > 0) {
      await sendConnectionOffer(intent, matches);
    }
  }
}

async function sendConnectionOffer(intent, matches) {
  const user = await index.users.get(intent.userId);
  
  // Create connection offer message
  const matchText = matches.map((match, i) => 
    \`\${i + 1}. <@\${match.userId}> - "\${match.payload.substring(0, 100)}..."\`
  ).join('\\n');
  
  const message = \`🤝 **Connection Opportunity**
  
Hey <@\${user.id}>! I found some potential collaborators for your intent:
"\${intent.payload.substring(0, 100)}..."

**Suggested Matches:**
\${matchText}

Would you like me to facilitate an introduction? React with ✅ to connect!\`;

  // Send DM to user
  const dmChannel = await slack.conversations.open({
    users: user.slackId
  });
  
  await slack.chat.postMessage({
    channel: dmChannel.channel.id,
    text: message,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: message
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '✅ Connect Me'
            },
            action_id: 'connect_users',
            value: JSON.stringify({
              intentId: intent.id,
              matchIds: matches.map(m => m.id)
            })
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '❌ Not Now'
            },
            action_id: 'skip_connection'
          }
        ]
      }
    ]
  });
}

// Handle button interactions
slack.action('connect_users', async ({ ack, body, client }) => {
  await ack();
  
  const { intentId, matchIds } = JSON.parse(body.actions[0].value);
  
  // Create intent pairs for connections
  for (const matchId of matchIds) {
    await index.intentPairs.create({
      intentIds: [intentId, matchId],
      event: 'REQUEST'
    });
  }
  
  await client.chat.postMessage({
    channel: body.channel.id,
    text: '🎉 Great! I\'ve initiated the connections. The other users will be notified!'
  });
});

// Run connection matching every hour
setInterval(offerConnections, 60 * 60 * 1000);`
      }
    ]
  }
];

const components: ComponentConfig[] = [
  {
    id: "intentform",
    name: "IntentForm",
    description: "A form component for creating and submitting new intents with customizable fields and validation.",
    previewImage: "/integrate/intent.gif",
    caseStudies: [
      {
        title: "YC Startup Directory",
        description: "How Y Combinator uses IntentForm for founder collaboration requests",
        link: "#case-study-yc"
      },
      {
        title: "Research Network Platform",
        description: "Academic researchers using IntentForm to find co-authors",
        link: "#case-study-research"
      }
    ],
    examples: [
      {
        title: "Usage",
        description: "Basic IntentForm component with core attributes",
        code: `import { IntentForm } from '@index/react';

<IntentForm 
  session={session}
  indexId="index-abc"
  onSubmit={(intent) => handleIntentSubmit(intent)}
/>`
      }
    ]
  },
  {
    id: "vibecheck",
    name: "VibeCheck",
    description: "Analyze and display compatibility scores between users, intents, or content with real-time vibe assessment.",
    previewImage: "/integrate/vibecheck.gif",
    caseStudies: [
      {
        title: "Dating App Integration",
        description: "How Bumble enhanced matching with VibeCheck compatibility scores",
        link: "#case-study-dating"
      },
      {
        title: "Team Formation Tool",
        description: "Startups using VibeCheck to build balanced co-founder teams",
        link: "#case-study-teams"
      }
    ],
    examples: [
      {
        title: "Usage",
        description: "Basic VibeCheck component with core attributes",
        code: `import { VibeCheck } from '@index/react';

<VibeCheck 
  session={session}
  indexId="index-abc"
  onResult={(result) => console.log('Vibe result:', result)}
/>`
      }
    ]
  },
  {
    id: "matchlist",
    name: "MatchList",
    description: "Display and manage intent matches with customizable filtering and sorting options.",
    previewImage: "/integrate/matchlist.png",
    caseStudies: [
      {
        title: "Freelancer Marketplace",
        description: "Upwork's implementation of MatchList for project-talent matching",
        link: "#case-study-freelance"
      },
      {
        title: "Investment Platform",
        description: "AngelList using MatchList to connect startups with investors",
        link: "#case-study-investment"
      }
    ],
    examples: [
      {
        title: "Usage",
        description: "Basic MatchList component with core attributes",
        code: `import { MatchList } from '@index/react';

<MatchList 
  session={session}
  indexId="index-abc"
  limit={10}
  sort="recency"
/>`
      }
    ]
  },

  {
    id: "radar",
    name: "Radar",
    description: "Interactive radar component for exploring connections and patterns within an index network.",
    previewImage: "/integrate/radar.gif",
    caseStudies: [
      {
        title: "Research Network Visualization",
        description: "Academic network using Radar for collaboration discovery",
        link: "#case-study-research"
      },
      {
        title: "Startup Ecosystem Mapping",
        description: "Venture capital firm implementing Radar for portfolio insights",
        link: "#case-study-ventures"
      }
    ],
    examples: [
      {
        title: "Usage",
        description: "Basic Radar component with core attributes",
        code: `import { Radar } from '@index/react';

<Radar 
  session={session}
  indexId="index-abc"
/>`
      }
    ]
  }
];

interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  description: string;
  example: string;
  params?: {
    name: string;
    type: string;
    required: boolean;
    description: string;
  }[];
  response?: string;
}

interface ApiSection {
  title: string;
  description: string;
  endpoints: ApiEndpoint[];
}

const apiSections: ApiSection[] = [
  {
    title: "Authentication",
    description: "Manage user authentication and profiles",
    endpoints: [
      {
        method: "GET",
        path: "/api/auth/me",
        description: "Get current authenticated user information",
        params: [],
        example: `fetch('/api/auth/me', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "PATCH",
        path: "/api/auth/profile",
        description: "Update current user's profile",
        params: [
          { name: "name", type: "string", required: false, description: "Updated display name" },
          { name: "avatar", type: "string", required: false, description: "Updated avatar URL" }
        ],
        example: `fetch('/api/auth/profile', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    name: 'John Smith',
    avatar: 'https://example.com/avatar.jpg'
  })
})`
      },
      {
        method: "DELETE",
        path: "/api/auth/account",
        description: "Delete current user's account",
        params: [],
        example: `fetch('/api/auth/account', {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      }
    ]
  },
  {
    title: "Users",
    description: "Manage user accounts and profiles",
    endpoints: [
      {
        method: "GET",
        path: "/api/users/{id}",
        description: "Get a specific user by ID",
        params: [
          { name: "id", type: "string", required: true, description: "Unique user identifier (UUID)" }
        ],
        example: `fetch('/api/users/user-123', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "PUT",
        path: "/api/users/{id}",
        description: "Update a user (only your own account)",
        params: [
          { name: "id", type: "string", required: true, description: "Unique user identifier (UUID)" },
          { name: "name", type: "string", required: false, description: "Updated display name (2-100 chars)" },
          { name: "avatar", type: "string", required: false, description: "Updated avatar URL" }
        ],
        example: `fetch('/api/users/user-123', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    name: 'John Smith',
    avatar: 'https://example.com/new-avatar.jpg'
  })
})`
      },
      {
        method: "DELETE",
        path: "/api/users/{id}",
        description: "Delete a user account (only your own)",
        params: [
          { name: "id", type: "string", required: true, description: "User ID to delete" }
        ],
        example: `fetch('/api/users/user-123', {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      }
    ]
  },
  {
    title: "Intents",
    description: "Create and manage user intents and collaboration requests",
    endpoints: [
      {
        method: "GET",
        path: "/api/intents",
        description: "Get intents with filtering and pagination",
        params: [
          { name: "page", type: "number", required: false, description: "Page number (default: 1)" },
          { name: "limit", type: "number", required: false, description: "Items per page (1-100, default: 10)" },
          { name: "archived", type: "boolean", required: false, description: "Show archived intents (default: false)" }
        ],
        example: `fetch('/api/intents?page=1&limit=20&archived=false', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "GET",
        path: "/api/intents/{id}",
        description: "Get a specific intent by ID",
        params: [
          { name: "id", type: "string", required: true, description: "Unique intent identifier (UUID)" }
        ],
        example: `fetch('/api/intents/intent-123', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "POST",
        path: "/api/intents",
        description: "Create a new intent",
        params: [
          { name: "payload", type: "string", required: true, description: "Detailed description of the intent" },
          { name: "isPublic", type: "boolean", required: false, description: "Whether intent is public (default: false)" },
          { name: "indexIds", type: "string[]", required: false, description: "Array of index IDs to associate with" }
        ],
        example: `fetch('/api/intents', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    payload: 'Looking for ML researchers to collaborate on AI research...',
    isPublic: false,
    indexIds: ['index-ai-research']
  })
})`
      },
      {
        method: "PUT",
        path: "/api/intents/{id}",
        description: "Update an intent",
        params: [
          { name: "id", type: "string", required: true, description: "Unique intent identifier" },
          { name: "payload", type: "string", required: false, description: "Updated intent description" },
          { name: "isPublic", type: "boolean", required: false, description: "Updated public status" }
        ],
        example: `fetch('/api/intents/intent-456', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    payload: 'Updated intent description',
    isPublic: true
  })
})`
      },
      {
        method: "PATCH",
        path: "/api/intents/{id}/archive",
        description: "Archive an intent",
        params: [
          { name: "id", type: "string", required: true, description: "Intent ID to archive" }
        ],
        example: `fetch('/api/intents/intent-456/archive', {
  method: 'PATCH',
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "PATCH",
        path: "/api/intents/{id}/unarchive",
        description: "Unarchive an intent",
        params: [
          { name: "id", type: "string", required: true, description: "Intent ID to unarchive" }
        ],
        example: `fetch('/api/intents/intent-456/unarchive', {
  method: 'PATCH',
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      }
    ]
  },
  {
    title: "Indexes",
    description: "Manage indexes and their memberships",
    endpoints: [
      {
        method: "GET",
        path: "/api/indexes",
        description: "Get indexes you own or are a member of",
        params: [
          { name: "page", type: "number", required: false, description: "Page number (default: 1)" },
          { name: "limit", type: "number", required: false, description: "Items per page (1-100, default: 10)" }
        ],
        example: `fetch('/api/indexes?page=1&limit=10', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "GET",
        path: "/api/indexes/{id}",
        description: "Get a specific index by ID",
        params: [
          { name: "id", type: "string", required: true, description: "Unique index identifier (UUID)" }
        ],
        example: `fetch('/api/indexes/index-123', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "POST",
        path: "/api/indexes",
        description: "Create a new index",
        params: [
          { name: "title", type: "string", required: true, description: "Title of the index (1-255 chars)" },
          { name: "isDiscoverable", type: "boolean", required: false, description: "Whether index is discoverable (default: false)" }
        ],
        example: `fetch('/api/indexes', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    title: 'AI Research Network',
    isDiscoverable: true
  })
})`
      },
      {
        method: "PUT",
        path: "/api/indexes/{id}",
        description: "Update an index",
        params: [
          { name: "id", type: "string", required: true, description: "Unique index identifier (UUID)" },
          { name: "title", type: "string", required: false, description: "Updated title (1-255 chars)" },
          { name: "isDiscoverable", type: "boolean", required: false, description: "Updated discovery status" }
        ],
        example: `fetch('/api/indexes/index-123', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    title: 'Updated AI Research Network',
    isDiscoverable: true
  })
})`
      },
      {
        method: "DELETE",
        path: "/api/indexes/{id}",
        description: "Delete an index (owner only)",
        params: [
          { name: "id", type: "string", required: true, description: "Index ID to delete" }
        ],
        example: `fetch('/api/indexes/index-123', {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "POST",
        path: "/api/indexes/{id}/members",
        description: "Add a member to an index (owner only)",
        params: [
          { name: "id", type: "string", required: true, description: "Index ID to add member to" },
          { name: "userId", type: "string", required: true, description: "User ID to add as member" }
        ],
        example: `fetch('/api/indexes/index-123/members', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    userId: 'user-456'
  })
})`
      },
      {
        method: "DELETE",
        path: "/api/indexes/{id}/members/{userId}",
        description: "Remove a member from an index",
        params: [
          { name: "id", type: "string", required: true, description: "Index ID to remove member from" },
          { name: "userId", type: "string", required: true, description: "User ID to remove from index" }
        ],
        example: `fetch('/api/indexes/index-123/members/user-456', {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      }
    ]
  },
  {
    title: "Files",
    description: "Manage files within indexes",
    endpoints: [
      {
        method: "GET",
        path: "/api/indexes/{indexId}/files",
        description: "Get files for a specific index",
        params: [
          { name: "indexId", type: "string", required: true, description: "Index ID to get files from" },
          { name: "page", type: "number", required: false, description: "Page number (default: 1)" },
          { name: "limit", type: "number", required: false, description: "Items per page (1-100, default: 10)" }
        ],
        example: `fetch('/api/indexes/index-123/files?page=1&limit=20', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "GET",
        path: "/api/indexes/{indexId}/files/{fileId}",
        description: "Get a specific file by ID within an index",
        params: [
          { name: "indexId", type: "string", required: true, description: "Index ID containing the file" },
          { name: "fileId", type: "string", required: true, description: "File ID to retrieve" }
        ],
        example: `fetch('/api/indexes/index-123/files/file-456', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "POST",
        path: "/api/indexes/{indexId}/files",
        description: "Upload a file to an index (max 100MB)",
        params: [
          { name: "indexId", type: "string", required: true, description: "Index ID to upload file to" },
          { name: "file", type: "File", required: true, description: "File object to upload" }
        ],
        example: `const formData = new FormData();
formData.append('file', fileBlob);

fetch('/api/indexes/index-123/files', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer \${token}' },
  body: formData
})`
      },
      {
        method: "DELETE",
        path: "/api/indexes/{indexId}/files/{fileId}",
        description: "Delete a file from an index",
        params: [
          { name: "indexId", type: "string", required: true, description: "Index ID containing the file" },
          { name: "fileId", type: "string", required: true, description: "File ID to delete" }
        ],
        example: `fetch('/api/indexes/index-123/files/file-456', {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      }
    ]
  },
  {
    title: "Suggested Intents",
    description: "Get AI-generated intent suggestions based on index content",
    endpoints: [
      {
        method: "GET",
        path: "/api/indexes/{indexId}/suggested_intents",
        description: "Get suggested intents for an index based on file summaries",
        params: [
          { name: "indexId", type: "string", required: true, description: "Index ID to generate suggestions for" }
        ],
        example: `fetch('/api/indexes/index-123/suggested_intents', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "GET",
        path: "/api/indexes/{indexId}/suggested_intents/preview",
        description: "Get intent preview with contextual integrity processing",
        params: [
          { name: "indexId", type: "string", required: true, description: "Index ID for context" },
          { name: "payload", type: "string", required: true, description: "Intent payload to process" }
        ],
        example: `fetch('/api/indexes/index-123/suggested_intents/preview?payload=Looking%20for%20collaborators', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      }
    ]
  },
  {
    title: "Agents",
    description: "Manage AI agents",
    endpoints: [
      {
        method: "GET",
        path: "/api/agents",
        description: "Get available agents with pagination",
        params: [
          { name: "page", type: "number", required: false, description: "Page number (default: 1)" },
          { name: "limit", type: "number", required: false, description: "Items per page (1-100, default: 10)" }
        ],
        example: `fetch('/api/agents?page=1&limit=10', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "GET",
        path: "/api/agents/{id}",
        description: "Get a specific agent by ID",
        params: [
          { name: "id", type: "string", required: true, description: "Unique agent identifier (UUID)" }
        ],
        example: `fetch('/api/agents/agent-123', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "POST",
        path: "/api/agents",
        description: "Create a new agent",
        params: [
          { name: "name", type: "string", required: true, description: "Agent name (2-100 chars)" },
          { name: "description", type: "string", required: true, description: "Agent description (min 2 chars)" },
          { name: "avatar", type: "string", required: true, description: "Agent avatar URL" }
        ],
        example: `fetch('/api/agents', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    name: 'Research Assistant',
    description: 'AI agent for academic research collaboration',
    avatar: 'https://example.com/agent-avatar.jpg'
  })
})`
      }
    ]
  }
];

export default function IntegratePage() {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [activeExamples, setActiveExamples] = useState<Record<string, number | 'overview'>>({
    intentform: 'overview',
    vibecheck: 'overview',
    matchlist: 'overview',
    radar: 'overview'
  });
  const [activeConversationalExamples, setActiveConversationalExamples] = useState<Record<string, number | 'overview'>>({
    matchmakeragent: 'overview',
    slack: 'overview',
    discord: 'overview',
    telegram: 'overview'
  });
  const [activeSection, setActiveSection] = useState<string>('installation');
  const [expandedApiSections, setExpandedApiSections] = useState<Record<string, boolean>>({});
  const [expandedEndpoints, setExpandedEndpoints] = useState<Record<string, boolean>>({});
  const [activeEndpointTabs, setActiveEndpointTabs] = useState<Record<string, 'params' | 'example'>>({});

  const [showConfigDialog, setShowConfigDialog] = useState(false);

  const setActiveExample = (componentId: string, exampleIndex: number | 'overview') => {
    setActiveExamples(prev => ({
      ...prev,
      [componentId]: exampleIndex
    }));
  };

  const setActiveConversationalExample = (integrationId: string, exampleIndex: number | 'overview') => {
    setActiveConversationalExamples(prev => ({
      ...prev,
      [integrationId]: exampleIndex
    }));
  };

  const copyToClipboard = async (code: string, exampleId: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(exampleId);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    console.log('Scrolling to:', sectionId, 'Element found:', !!element);
    if (element) {
      setTimeout(() => {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  };

  const toggleApiSection = (sectionIndex: number) => {
    setExpandedApiSections(prev => ({
      ...prev,
      [sectionIndex]: !prev[sectionIndex]
    }));
  };

  const toggleEndpoint = (sectionIndex: number, endpointIndex: number) => {
    const key = `${sectionIndex}-${endpointIndex}`;
    setExpandedEndpoints(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
    
    // Set default tab to 'example' when expanding
    if (!expandedEndpoints[key]) {
      setActiveEndpointTabs(prev => ({
        ...prev,
        [key]: 'example'
      }));
    }
  };

  const setEndpointTab = (sectionIndex: number, endpointIndex: number, tab: 'params' | 'example') => {
    const key = `${sectionIndex}-${endpointIndex}`;
    setActiveEndpointTabs(prev => ({
      ...prev,
      [key]: tab
    }));
  };

  // Track active section on scroll
  useEffect(() => {
    const sections = ['api', 'installation', ...components.map(c => `component-${c.id}`), 'conversational', ...conversationalIntegrations.map(c => `conversational-${c.id}`)];
    const scrollPosition = window.scrollY + 100;

    for (const sectionId of sections) {
      const element = document.getElementById(sectionId);
      if (element) {
        const elementTop = element.offsetTop;
        const elementBottom = elementTop + element.offsetHeight;
        
        if (scrollPosition >= elementTop && scrollPosition < elementBottom) {
          setActiveSection(sectionId);
          break;
        }
      }
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const sections = ['api', 'installation', ...components.map(c => `component-${c.id}`), 'conversational', ...conversationalIntegrations.map(c => `conversational-${c.id}`)];
      const scrollPosition = window.scrollY + 100;

      for (const sectionId of sections) {
        const element = document.getElementById(sectionId);
        if (element) {
          const elementTop = element.offsetTop;
          const elementBottom = elementTop + element.offsetHeight;
          
          if (scrollPosition >= elementTop && scrollPosition < elementBottom) {
            setActiveSection(sectionId);
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const installCode = `npm install @index/react`;

  return (
    <ClientLayout>
      <div className="relative">
        {/* Side Navigator - positioned absolutely on the left */}
        <div className="hidden xl:block fixed left-4 top-48 w-64 z-10">
          <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <h3 className="font-semibold text-gray-900 font-ibm-plex-mono text-sm mb-4">
              Navigation
            </h3>
            <nav className="space-y-2">
              <button
                onClick={() => scrollToSection('api')}
                className={`block w-full text-left px-2 py-1 text-sm font-ibm-plex-mono rounded transition-colors ${
                  activeSection === 'api'
                    ? 'bg-amber-100 text-amber-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                API Reference
              </button>
              
              <div className="pt-2">
                <div className="text-xs font-semibold text-gray-500 font-ibm-plex-mono mb-2 px-2">
                  UI COMPONENTS
                </div>
                <button
                  onClick={() => scrollToSection('installation')}
                  className={`block w-full text-left px-2 py-1 text-sm font-ibm-plex-mono rounded transition-colors ${
                    activeSection === 'installation'
                      ? 'bg-amber-100 text-amber-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  Installation
                </button>
                {components.map((component) => (
                  <button
                    key={component.id}
                    onClick={() => scrollToSection(`component-${component.id}`)}
                    className={`block w-full text-left px-2 py-1 text-sm font-ibm-plex-mono rounded transition-colors ${
                      activeSection === `component-${component.id}`
                        ? 'bg-amber-100 text-amber-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    &lt;{component.name}/&gt;
                  </button>
                ))}
              </div>
              
              <div className="pt-4">
                <div className="text-xs font-semibold text-gray-500 font-ibm-plex-mono mb-2 px-2">
                  CONVERSATIONAL
                </div>
                {conversationalIntegrations.map((integration) => (
                  <button
                    key={integration.id}
                    onClick={() => scrollToSection(`conversational-${integration.id}`)}
                    className={`block w-full text-left px-2 py-1 text-sm font-ibm-plex-mono rounded transition-colors ${
                      activeSection === `conversational-${integration.id}`
                        ? 'bg-amber-100 text-amber-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    {integration.name}
                  </button>
                ))}
              </div>
              
            </nav>
          </div>
        </div>

        {/* Main Content - centered as original */}
        <div className="w-full border border-gray-200 rounded-md px-4 py-8" style={{
          backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
          backgroundColor: 'white',
          backgroundSize: '888px'
        }}>
          
          {/* Header */}
          <div className="bg-white px-4 py-6 border border-black border-b-2 mb-6">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono mb-2">
                  Integration Guide
                </h1>
                <p className="text-gray-600 font-ibm-plex-mono text-md">
                  Embed Index Network components in your application
                </p>
              </div>
              <Button 
                className="flex items-center gap-2 whitespace-nowrap"
                onClick={() => window.open('https://llmstxt.org', '_blank')}
                variant="outline"
              >
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">llms.txt</span>
              </Button>
            </div>
          </div>

          {/* API Reference */}
          <div id="api" className="bg-white border border-black border-b-2 px-4 py-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 font-ibm-plex-mono">
                  API Reference
                </h2>
                <p className="text-gray-600 font-ibm-plex-mono text-sm mt-2">
                  All endpoints require authentication.
                </p>
              </div>
              <Button 
                className="flex items-center gap-2 whitespace-nowrap"
                onClick={() => setShowConfigDialog(true)}
              >
                <MCP className="h-4 w-4" />
                <span className="hidden sm:inline">Configure MCP</span>
              </Button>
            </div>

            {/* Authentication Section */}
            <div className="mb-6 border border-gray-200 rounded-lg p-4 bg-amber-50">
              <h3 className="text-lg font-semibold text-gray-900 font-ibm-plex-mono mb-2">
                Authentication
              </h3>
              <p className="text-gray-600 text-sm mb-3">
                All API endpoints require authentication using Bearer tokens in the Authorization header.
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded p-2">
                <code className="text-gray-800 font-mono text-sm">
                  Authorization: Bearer YOUR_API_TOKEN
                </code>
              </div>
            </div>            

            <div className="space-y-4">
              {apiSections.map((section, sectionIndex) => (
                <div key={sectionIndex} className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* Section Header */}
                  <button
                    onClick={() => toggleApiSection(sectionIndex)}
                    className="w-full bg-gray-50 hover:bg-gray-100 px-4 py-3 flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {expandedApiSections[sectionIndex] ? 
                        <ChevronDown className="h-4 w-4 text-gray-500" /> : 
                        <ChevronRight className="h-4 w-4 text-gray-500" />
                      }
                      <h3 className="text-lg font-semibold text-gray-900 font-ibm-plex-mono">
                        {section.title}
                      </h3>
                      <span className="text-sm text-gray-500 bg-gray-200 px-2 py-1 rounded">
                        {section.endpoints.length} endpoints
                      </span>
                    </div>
                  </button>
                  
                  {/* Section Content */}
                  {expandedApiSections[sectionIndex] && (
                    <div className="border-t border-gray-200 bg-white">
                      <div className="px-4 py-6">
                        <p className="text-gray-600 text-sm mb-4">
                          {section.description}
                        </p>
                        
                        <div className="space-y-2">
                          {section.endpoints.map((endpoint, endpointIndex) => {
                            const endpointKey = `${sectionIndex}-${endpointIndex}`;
                            const isExpanded = expandedEndpoints[endpointKey];
                            const activeTab = activeEndpointTabs[endpointKey] || 'example';
                            
                            return (
                              <div key={endpointIndex} className="border border-gray-100 rounded overflow-hidden">
                                {/* Endpoint Header */}
                                <button
                                  onClick={() => toggleEndpoint(sectionIndex, endpointIndex)}
                                  className="w-full bg-gray-25 hover:bg-gray-50 px-3 py-2 flex items-center justify-between transition-colors"
                                >
                                  <div className="flex items-center gap-3">
                                    {isExpanded ? 
                                      <ChevronDown className="h-3 w-3 text-gray-400" /> : 
                                      <ChevronRight className="h-3 w-3 text-gray-400" />
                                    }
                                    <span className={`px-2 py-1 text-xs font-mono rounded ${
                                      endpoint.method === 'GET' ? 'bg-blue-100 text-blue-700' :
                                      endpoint.method === 'POST' ? 'bg-green-100 text-green-700' :
                                      endpoint.method === 'PUT' ? 'bg-yellow-100 text-yellow-700' :
                                      'bg-red-100 text-red-700'
                                    }`}>
                                      {endpoint.method}
                                    </span>
                                    <code className="text-gray-700 font-mono text-sm">
                                      {endpoint.path}
                                    </code>
                                  </div>
                                  <span className="text-xs text-gray-500">
                                    {endpoint.description}
                                  </span>
                                </button>

                                {/* Endpoint Content */}
                                {isExpanded && (
                                  <div className="border-t border-gray-100 bg-white">
                                    {/* Tabs */}
                                    <div className="flex border-b border-gray-100">
                                      {endpoint.params && (
                                        <button
                                          onClick={() => setEndpointTab(sectionIndex, endpointIndex, 'params')}
                                          className={`px-4 py-2 text-sm font-medium transition-colors ${
                                            activeTab === 'params'
                                              ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-500'
                                              : 'text-gray-500 hover:text-gray-700'
                                          }`}
                                        >
                                          Parameters
                                        </button>
                                      )}
                                      <button
                                        onClick={() => setEndpointTab(sectionIndex, endpointIndex, 'example')}
                                        className={`px-4 py-2 text-sm font-medium transition-colors ${
                                          activeTab === 'example'
                                            ? 'bg-amber-50 text-amber-600 border-b-2 border-amber-500'
                                            : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                      >
                                        Code Example
                                      </button>
                                    </div>

                                    {/* Tab Content */}
                                    <div className="p-4">
                                      {activeTab === 'params' && endpoint.params && (
                                        <div className="space-y-3">
                                          {endpoint.params.map((param, paramIndex) => (
                                            <div key={paramIndex} className="flex items-start gap-4 p-3 bg-gray-50 rounded border">
                                              <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                  <code className="text-sm font-mono text-gray-900">
                                                    {param.name}
                                                  </code>
                                                  <span className="text-xs text-gray-500 bg-gray-200 px-1 rounded">
                                                    {param.type}
                                                  </span>
                                                  {param.required && (
                                                    <span className="text-xs text-red-600 bg-red-100 px-1 rounded">
                                                      required
                                                    </span>
                                                  )}
                                                </div>
                                                <p className="text-sm text-gray-600">
                                                  {param.description}
                                                </p>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}

                                      {activeTab === 'example' && (
                                        <div className="bg-gray-50 border border-gray-200 rounded overflow-hidden">
                                          <div className="bg-gray-100 px-3 py-2 border-b border-gray-200 flex justify-between items-center">
                                            <span className="text-xs font-medium text-gray-700 font-ibm-plex-mono">
                                              Request Example
                                            </span>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => copyToClipboard(endpoint.example, `api-${sectionIndex}-${endpointIndex}`)}
                                            >
                                              {copiedCode === `api-${sectionIndex}-${endpointIndex}` ? 
                                                <Check className="h-3 w-3" /> : 
                                                <Copy className="h-3 w-3" />
                                              }
                                            </Button>
                                          </div>
                                          <SyntaxHighlighter
                                            language="javascript"
                                            style={tomorrow}
                                            customStyle={{
                                              margin: 0,
                                              padding: '12px',
                                              fontSize: '12px',
                                              lineHeight: '1.4',
                                            }}
                                            showLineNumbers={false}
                                          >
                                            {endpoint.example}
                                          </SyntaxHighlighter>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>


          </div>

        </div>

        {/* Components Section - separate container */}
        <div className="w-full border border-gray-200 rounded-md mt-4 px-4 py-8" style={{
          backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
          backgroundColor: 'white',
          backgroundSize: '888px'
        }}>

          {/* Components Header */}
          <div className="bg-white border border-black border-b-2 px-4 py-6 mb-6">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono mb-2">
                  Embedded Discovery
                </h1>
                <p className="text-gray-600 font-ibm-plex-mono text-md">
                  UI components for building collaborative discovery experiences
                </p>
              </div>
            </div>
          </div>

          {/* Installation */}
          <div id="installation" className="bg-white border border-black border-b-2 px-4 py-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 font-ibm-plex-mono mb-4">
              Installation
            </h2>
            <div className="bg-gray-50 border border-gray-200 p-2 flex items-center justify-between">
              <code className="text-gray-800 font-mono">{installCode}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(installCode, 'install')}
                className="ml-4"
              >
                {copiedCode === 'install' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

          </div>

          {/* Components */}
          {components.map((component) => {
            console.log('Rendering component:', component.id, 'with ID:', `component-${component.id}`);
            return (
            <div key={component.id} id={`component-${component.id}`} className="bg-white border border-black border-b-2 p-6 mb-6">
              <h2 className="text-2xl font-semibold text-gray-900 font-ibm-plex-mono mb-2">
                &lt;{component.name}/&gt;
              </h2>
              <p className="text-gray-900 mb-5 font-ibm-plex-mono text-sm">
                    {component.description}
                  </p>
              {/* Tabs */}
              <div className="flex gap-4 mb-6 border-b border-gray-200 overflow-x-auto">
                <button
                  onClick={() => setActiveExample(component.id, 'overview')}
                  className={`pb-2 px-1 font-ibm-plex-mono text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeExamples[component.id] === 'overview'
                      ? 'border-amber-500 text-amber-600' 
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Overview
                </button>
                {component.examples.map((example, index) => (
                  <button
                    key={index}
                    onClick={() => setActiveExample(component.id, index)}
                    className={`pb-2 px-1 font-ibm-plex-mono text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeExamples[component.id] === index
                        ? 'border-amber-500 text-amber-600' 
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {example.title}
                  </button>
                ))}
              </div>

              {/* Overview Tab Content */}
              {activeExamples[component.id] === 'overview' && (
                <div className="">

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left Column: Image */}
                    <div>
                      <Image 
                        src={component.previewImage} 
                        alt={`${component.name} preview`}
                        width={500}
                        height={300}
                        className="w-full shadow-lg"
                      />
                    </div>
                    
                    {/* Right Column: Case Studies & Example Links */}
                    <div className="">
                      <h4 className="text-md font-semibold text-gray-900 font-ibm-plex-mono -mt-1.5 mb-2">
                        Examples
                      </h4>
                      <div className="space-y-2">
                        {component.caseStudies.map((caseStudy, index) => (
                          <a
                            key={index}
                            href={caseStudy.link}
                            className="text-sm block text-amber-600 hover:text-amber-700 hover:underline font-ibm-plex-mono"
                          >
                            {caseStudy.title} →
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Example Tab Content */}
              {typeof activeExamples[component.id] === 'number' && component.examples[activeExamples[component.id] as number] && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                    <div>
                      <h4 className="font-medium text-gray-900 font-ibm-plex-mono">
                        {component.examples[activeExamples[component.id] as number].title}
                      </h4>
                      <p className="text-sm text-gray-600 mt-1">
                        {component.examples[activeExamples[component.id] as number].description}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(
                        component.examples[activeExamples[component.id] as number].code, 
                        `${component.id}-${activeExamples[component.id]}`
                      )}
                    >
                      {copiedCode === `${component.id}-${activeExamples[component.id]}` ? 
                        <Check className="h-4 w-4" /> : 
                        <Copy className="h-4 w-4" />
                      }
                    </Button>
                  </div>
                  <SyntaxHighlighter
                    language="jsx"
                    style={tomorrow}
                    customStyle={{
                      margin: 0,
                      padding: '1.5rem',
                      fontSize: '14px',
                      lineHeight: '1.5',
                    }}
                    showLineNumbers={false}
                  >
                    {component.examples[activeExamples[component.id] as number].code}
                  </SyntaxHighlighter>
                </div>
              )}
            </div>
          );
        })}

        </div>        
      </div>

      {/* Conversational Integrations Section */}
      <div className="w-full border border-gray-200 rounded-md mt-4 px-4 py-8" style={{
        backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>

        {/* Conversational Header */}
        <div className="bg-white border border-black border-b-2 px-4 py-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono mb-2">
                Conversational Agents
              </h1>
              <p className="text-gray-600 font-ibm-plex-mono text-md">
                Deploy Index Network across chat platforms and conversational interfaces
              </p>
            </div>
          </div>
        </div>

        {/* Conversational Integrations */}
        {conversationalIntegrations.map((integration) => {
          return (
          <div key={integration.id} id={`conversational-${integration.id}`} className="bg-white border border-black border-b-2 p-6 mb-6">
            <h2 className="text-2xl font-semibold text-gray-900 font-ibm-plex-mono mb-2">
              {integration.name}
            </h2>
            <p className="text-gray-900 mb-5 font-ibm-plex-mono text-sm">
              {integration.description}
            </p>
            
            {/* Tabs */}
            <div className="flex gap-4 mb-6 border-b border-gray-200 overflow-x-auto">
              <button
                onClick={() => setActiveConversationalExample(integration.id, 'overview')}
                className={`pb-2 px-1 font-ibm-plex-mono text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeConversationalExamples[integration.id] === 'overview'
                    ? 'border-amber-500 text-amber-600' 
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Overview
              </button>
              {integration.examples.map((example, index) => (
                <button
                  key={index}
                  onClick={() => setActiveConversationalExample(integration.id, index)}
                  className={`pb-2 px-1 font-ibm-plex-mono text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeConversationalExamples[integration.id] === index
                      ? 'border-amber-500 text-amber-600' 
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {example.title}
                </button>
              ))}
            </div>

            {/* Overview Tab Content */}
            {activeConversationalExamples[integration.id] === 'overview' && (
              <div className="">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left Column: Image */}
                  <div>
                    <Image 
                      src={integration.previewImage} 
                      alt={`${integration.name} preview`}
                      width={500}
                      height={300}
                      className="w-full shadow-lg"
                    />
                  </div>
                  
                  {/* Right Column: Case Studies */}
                  <div className="">
                    <h4 className="text-md font-semibold text-gray-900 font-ibm-plex-mono -mt-1.5 mb-2">
                      Examples
                    </h4>
                    <div className="space-y-2">
                      {integration.caseStudies.map((caseStudy, index) => (
                        <a
                          key={index}
                          href={caseStudy.link}
                          className="text-sm block text-amber-600 hover:text-amber-700 hover:underline font-ibm-plex-mono"
                        >
                          {caseStudy.title} →
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Example Tab Content */}
            {typeof activeConversationalExamples[integration.id] === 'number' && integration.examples[activeConversationalExamples[integration.id] as number] && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-gray-900 font-ibm-plex-mono">
                      {integration.examples[activeConversationalExamples[integration.id] as number].title}
                    </h4>
                    <p className="text-sm text-gray-600 mt-1">
                      {integration.examples[activeConversationalExamples[integration.id] as number].description}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(
                      integration.examples[activeConversationalExamples[integration.id] as number].code, 
                      `${integration.id}-${activeConversationalExamples[integration.id]}`
                    )}
                  >
                    {copiedCode === `${integration.id}-${activeConversationalExamples[integration.id]}` ? 
                      <Check className="h-4 w-4" /> : 
                      <Copy className="h-4 w-4" />
                    }
                  </Button>
                </div>
                <SyntaxHighlighter
                  language="javascript"
                  style={tomorrow}
                  customStyle={{
                    margin: 0,
                    padding: '1.5rem',
                    fontSize: '14px',
                    lineHeight: '1.5',
                  }}
                  showLineNumbers={false}
                >
                  {integration.examples[activeConversationalExamples[integration.id] as number].code}
                </SyntaxHighlighter>
              </div>
            )}
          </div>
        );
      })}

      </div>

      {/* Bottom spacing for sidebar navigation */}
      <div className="h-64"></div>
      
      {/* Configure MCP Modal */}
      <ConfigureModal 
        open={showConfigDialog}
        onOpenChange={setShowConfigDialog}
      />
    </ClientLayout>
  );
}