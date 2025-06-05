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
        title: "Basic Intent Form",
        description: "Simple form for creating intents",
        code: `import { IntentForm } from '@index/react';

<IntentForm 
  userId="user-123"
  onSubmit={(intent) => console.log('Intent created:', intent)}
/>`
      },
      {
        title: "Form with Index Association",
        description: "Associate intent with a specific index",
        code: `import { IntentForm } from '@index/react';

<IntentForm 
  userId="user-123"
  indexId="index-abc"
  onSubmit={(intent) => handleIntentSubmit(intent)}
  onCancel={() => setShowForm(false)}
/>`
      },
      {
        title: "Advanced Configuration",
        description: "Form with advanced options and custom theme",
        code: `import { IntentForm } from '@index/react';

<IntentForm 
  userId="user-123"
  onSubmit={(intent) => handleIntentSubmit(intent)}
  showAdvanced={true}
  theme="dark"
  initialValues={{
    title: "AI Research Collaboration",
    category: "research"
  }}
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
        title: "User-to-User Vibe Check",
        description: "Check compatibility between two users",
        code: `import { VibeCheck } from '@index/react';

<VibeCheck 
  sourceId="user-123"
  targetId="user-456"
  type="user-user"
/>`
      },
      {
        title: "User-to-Intent Compatibility",
        description: "Check if a user matches an intent",
        code: `import { VibeCheck } from '@index/react';

<VibeCheck 
  sourceId="user-123"
  targetId="intent-ai-research"
  type="user-intent"
  onVibeResult={(result) => console.log('Compatibility:', result)}
/>`
      },
      {
        title: "Full Configuration",
        description: "Complete example with all available options",
        code: `import { VibeCheck } from '@index/react';

<VibeCheck 
  sourceId="user-123"
  targetId="intent-ai-research"
  type="user-intent"
  showDetails={true}
  animated={true}
  onVibeResult={(result) => handleVibeResult(result)}
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
        title: "Basic Usage",
        description: "Simple match list for a specific viewer",
        code: `import { MatchList } from '@index/react';

<MatchList viewer="user-123" />`
      },
      {
        title: "Filter by Index",
        description: "Show matches only within specific indexes",
        code: `import { MatchList } from '@index/react';

<MatchList 
  viewer="user-123"
  indexes={["index-abc", "index-def"]}
  limit={10}
/>`
      },
      {
        title: "With Match Handlers",
        description: "Handle match acceptance and decline events",
        code: `import { MatchList } from '@index/react';

<MatchList 
  viewer="user-123"
  users={["user-456", "user-789"]}
  intents={["intent-ai", "intent-blockchain"]}
  sort="stake"
  onMatchAccept={(match) => handleAccept(match)}
  onMatchDecline={(match) => handleDecline(match)}
/>`
      },
      {
        title: "Full Configuration",
        description: "Complete example with all available options",
        code: `import { MatchList } from '@index/react';

<MatchList 
  viewer="user-123"
  users={["user-456", "user-789"]}
  intents={["intent-ai", "intent-blockchain"]}
  indexes={["index-abc", "index-def"]}
  limit={15}
  sort="recency"
  onMatchAccept={(match) => handleAccept(match)}
  onMatchDecline={(match) => handleDecline(match)}
/>`
      }
    ]
  },
  {
    id: "matchmakeragent",
    name: "MatchmakerAgent",
    description: "AI-powered matchmaking agent that provides intelligent match suggestions and facilitates connections.",
    previewImage: "/integrate/intent.gif",
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
        title: "Basic Matchmaker",
        description: "Simple AI matchmaker for a user",
        code: `import { MatchmakerAgent } from '@index/react';

<MatchmakerAgent 
  userId="user-123"
/>`
      },
      {
        title: "Full Configuration",
        description: "Complete agent setup with all options",
        code: `import { MatchmakerAgent } from '@index/react';

<MatchmakerAgent 
  userId="user-123"
  agentPersonality="enthusiastic"
  maxSuggestions={10}
  autoRefresh={true}
  focusAreas={["technology", "startups", "research"]}
  onMatchSuggestion={(suggestion) => handleSuggestion(suggestion)}
  onConversationStart={(matchId) => openChat(matchId)}
  showReasoningProcess={false}
/>`
      }
    ]
  },
  {
    id: "radar",
    name: "Radar",
    description: "Privacy-aware input component with configurable anonymization levels and data protection settings.",
    previewImage: "/integrate/radar.gif",
    caseStudies: [
      {
        title: "Healthcare Platform",
        description: "Medical research platform using PrivacyInput for patient data collection",
        link: "#case-study-healthcare"
      },
      {
        title: "Financial Services",
        description: "Banking app implementing PrivacyInput for sensitive information handling",
        link: "#case-study-finance"
      }
    ],
    examples: [
      {
        title: "Basic Privacy Input",
        description: "Simple privacy-aware input field",
        code: `import { PrivacyInput } from '@index/react';

<PrivacyInput 
  placeholder="Enter sensitive information"
  privacyLevel="medium"
  onValueChange={(value, metadata) => console.log('Value:', value)}
/>`
      },
      {
        title: "Medical Data Input",
        description: "Input for healthcare data with HIPAA compliance",
        code: `import { PrivacyInput } from '@index/react';

<PrivacyInput 
  type="medical"
  placeholder="Patient information"
  privacyLevel="high"
  anonymization={true}
  encryption={true}
  onValueChange={(value, metadata) => handleMedicalData(value, metadata)}
  complianceStandards={["HIPAA", "GDPR"]}
/>`
      },
      {
        title: "Full Configuration",
        description: "Complete privacy input with all available options",
        code: `import { PrivacyInput } from '@index/react';

<PrivacyInput 
  type="personal"
  placeholder="Enter personal details"
  privacyLevel="maximum"
  anonymization={true}
  encryption={true}
  dataRetention="30days"
  auditTrail={true}
  onValueChange={(value, metadata) => handlePrivateData(value, metadata)}
  onPrivacyLevelChange={(level) => updatePrivacySettings(level)}
  complianceStandards={["GDPR", "CCPA", "SOX"]}
  showPrivacyIndicator={true}
  allowUserControl={true}
/>`
      }
    ]
  }
];

interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
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
    title: "Users",
    description: "Manage user accounts and profiles",
    endpoints: [
      {
        method: "GET",
        path: "/api/users",
        description: "Get all users with optional filtering",
        params: [
          { name: "limit", type: "number", required: false, description: "Maximum number of users to return (default: 20)" },
          { name: "offset", type: "number", required: false, description: "Number of users to skip for pagination" },
          { name: "email", type: "string", required: false, description: "Filter by email address" },
          { name: "name", type: "string", required: false, description: "Filter by user name (partial match)" }
        ],
        example: `fetch('/api/users?limit=10&offset=0', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
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
        method: "POST",
        path: "/api/users",
        description: "Create a new user",
        params: [
          { name: "email", type: "string", required: true, description: "User's email address (must be unique)" },
          { name: "name", type: "string", required: true, description: "User's display name" },
          { name: "avatar", type: "string", required: false, description: "URL to user's avatar image" }
        ],
        example: `fetch('/api/users', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    email: 'user@example.com',
    name: 'John Doe',
    avatar: 'https://example.com/avatar.jpg'
  })
})`
      },
      {
        method: "PUT",
        path: "/api/users/{id}",
        description: "Update an existing user",
        params: [
          { name: "id", type: "string", required: true, description: "Unique user identifier (UUID)" },
          { name: "name", type: "string", required: false, description: "Updated display name" },
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
          { name: "userId", type: "string", required: false, description: "Filter by user ID" },
          { name: "status", type: "string", required: false, description: "Filter by intent status (active, fulfilled, cancelled)" },
          { name: "limit", type: "number", required: false, description: "Maximum number of intents to return" },
          { name: "offset", type: "number", required: false, description: "Number of intents to skip for pagination" }
        ],
        example: `fetch('/api/intents?userId=user-123&status=active&limit=20', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "POST",
        path: "/api/intents",
        description: "Create a new intent",
        params: [
          { name: "title", type: "string", required: true, description: "Brief title describing the intent" },
          { name: "payload", type: "string", required: true, description: "Detailed description of the intent" },
          { name: "userId", type: "string", required: true, description: "ID of the user creating the intent" },
          { name: "status", type: "string", required: false, description: "Initial status (default: active)" },
          { name: "indexes", type: "string[]", required: false, description: "Array of index IDs to associate with" }
        ],
        example: `fetch('/api/intents', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    title: 'AI Research Collaboration',
    payload: 'Looking for ML researchers to collaborate on...',
    userId: 'user-123',
    status: 'active',
    indexes: ['index-ai-research']
  })
})`
      },
      {
        method: "PUT",
        path: "/api/intents/{id}",
        description: "Update an intent",
        params: [
          { name: "id", type: "string", required: true, description: "Unique intent identifier" },
          { name: "title", type: "string", required: false, description: "Updated intent title" },
          { name: "payload", type: "string", required: false, description: "Updated intent description" },
          { name: "status", type: "string", required: false, description: "Updated status" }
        ],
        example: `fetch('/api/intents/intent-456', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    title: 'Updated Intent Title',
    status: 'fulfilled'
  })
})`
      },
      {
        method: "DELETE",
        path: "/api/intents/{id}",
        description: "Soft delete an intent",
        params: [
          { name: "id", type: "string", required: true, description: "Unique intent identifier to delete" }
        ],
        example: `fetch('/api/intents/intent-456', {
  method: 'DELETE',
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
        description: "Get indexes with optional user filtering",
        params: [
          { name: "userId", type: "string", required: false, description: "Filter by index owner" },
          { name: "memberId", type: "string", required: false, description: "Filter by member user ID" },
          { name: "limit", type: "number", required: false, description: "Maximum number of indexes to return" }
        ],
        example: `fetch('/api/indexes?userId=user-123', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "POST",
        path: "/api/indexes",
        description: "Create a new index",
        params: [
          { name: "name", type: "string", required: true, description: "Name of the index" },
          { name: "userId", type: "string", required: true, description: "ID of the user creating the index" }
        ],
        example: `fetch('/api/indexes', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    name: 'AI Research Network',
    userId: 'user-123'
  })
})`
      },
      {
        method: "POST",
        path: "/api/indexes/{id}/members",
        description: "Add members to an index",
        params: [
          { name: "id", type: "string", required: true, description: "Index ID to add members to" },
          { name: "userIds", type: "string[]", required: true, description: "Array of user IDs to add as members" }
        ],
        example: `fetch('/api/indexes/index-123/members', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    userIds: ['user-456', 'user-789']
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
    title: "Intent Pairs & Matching",
    description: "Manage intent matching and pair interactions",
    endpoints: [
      {
        method: "GET",
        path: "/api/intent-pairs",
        description: "Get intent pairs with filtering",
        params: [
          { name: "userId", type: "string", required: false, description: "Filter by user involved in intent pair" },
          { name: "lastEvent", type: "string", required: false, description: "Filter by last event type (REQUEST, ACCEPT, etc.)" },
          { name: "limit", type: "number", required: false, description: "Maximum number of pairs to return" }
        ],
        example: `fetch('/api/intent-pairs?userId=user-123&lastEvent=REQUEST', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "POST",
        path: "/api/intent-pairs",
        description: "Create or update an intent pair interaction",
        params: [
          { name: "intentIds", type: "string[]", required: true, description: "Array of two intent IDs to pair" },
          { name: "event", type: "string", required: true, description: "Event type: REQUEST, SKIP, CANCEL, ACCEPT, DECLINE, REMOVE" }
        ],
        example: `fetch('/api/intent-pairs', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    intentIds: ['intent-123', 'intent-456'],
    event: 'REQUEST'
  })
})`
      },
      {
        method: "PUT",
        path: "/api/intent-pairs/{id}/event",
        description: "Update intent pair event status",
        params: [
          { name: "id", type: "string", required: true, description: "Intent pair ID" },
          { name: "event", type: "string", required: true, description: "New event type: REQUEST, SKIP, CANCEL, ACCEPT, DECLINE, REMOVE" }
        ],
        example: `fetch('/api/intent-pairs/pair-123/event', {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    event: 'ACCEPT'
  })
})`
      }
    ]
  },
  {
    title: "Agents & Backers",
    description: "Manage AI agents and their backing confidence scores",
    endpoints: [
      {
        method: "GET",
        path: "/api/agents",
        description: "Get available agents",
        params: [
          { name: "role", type: "string", required: false, description: "Filter by agent role (USER or SYSTEM)" },
          { name: "limit", type: "number", required: false, description: "Maximum number of agents to return" }
        ],
        example: `fetch('/api/agents?role=SYSTEM', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "GET",
        path: "/api/backers",
        description: "Get agent backing data for intent pairs",
        params: [
          { name: "intentPairId", type: "string", required: false, description: "Filter by specific intent pair" },
          { name: "agentId", type: "string", required: false, description: "Filter by specific agent" },
          { name: "confidence", type: "number", required: false, description: "Minimum confidence threshold (0.0-1.0)" }
        ],
        example: `fetch('/api/backers?intentPairId=pair-123&confidence=0.8', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "POST",
        path: "/api/backers",
        description: "Create agent backing for intent pair",
        params: [
          { name: "agentId", type: "string", required: true, description: "ID of the agent providing backing" },
          { name: "intentPairId", type: "string", required: true, description: "ID of the intent pair being backed" },
          { name: "confidence", type: "number", required: true, description: "Confidence score (0.0-1.0)" }
        ],
        example: `fetch('/api/backers', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer \${token}'
  },
  body: JSON.stringify({
    agentId: 'agent-123',
    intentPairId: 'pair-456',
    confidence: 0.92
  })
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
        path: "/api/files",
        description: "Get files with index filtering",
        params: [
          { name: "indexId", type: "string", required: false, description: "Filter by specific index" },
          { name: "limit", type: "number", required: false, description: "Maximum number of files to return" },
          { name: "name", type: "string", required: false, description: "Filter by file name (partial match)" }
        ],
        example: `fetch('/api/files?indexId=index-123&limit=50', {
  headers: { 'Authorization': 'Bearer \${token}' }
})`
      },
      {
        method: "POST",
        path: "/api/files",
        description: "Upload a file to an index",
        params: [
          { name: "file", type: "File", required: true, description: "File object to upload" },
          { name: "indexId", type: "string", required: true, description: "Index ID to associate file with" }
        ],
        example: `const formData = new FormData();
formData.append('file', fileBlob);
formData.append('indexId', 'index-123');

fetch('/api/files', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer \${token}' },
  body: formData
})`
      },
      {
        method: "DELETE",
        path: "/api/files/{id}",
        description: "Delete a file",
        params: [
          { name: "id", type: "string", required: true, description: "File ID to delete" }
        ],
        example: `fetch('/api/files/file-123', {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer \${token}' }
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
    matchmakeragent: 'overview',
    radar: 'overview'
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
    const handleScroll = () => {
      const sections = ['api', 'installation', ...components.map(c => `component-${c.id}`)];
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
                  COMPONENTS
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
                  Embed Index Protocol components in your application
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
                  REST API endpoints compatible with Prisma schema. All endpoints require authentication.
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
      
      {/* Configure MCP Modal */}
      <ConfigureModal 
        open={showConfigDialog}
        onOpenChange={setShowConfigDialog}
      />
    </ClientLayout>
  );
}