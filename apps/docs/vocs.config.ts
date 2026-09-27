import { defineConfig } from 'vocs/config'

export default defineConfig({
  title: 'Index Network',
  baseUrl: 'https://docs.index.network',
  description: 'A private, intent-driven social discovery protocol.',
  iconUrl: '/favicon.svg',
  logoUrl: {
    light: '/logos/logo-black-full.svg',
    dark: '/logos/logo-white-full.svg',
  },
  accentColor: '#E08A2E',
  head: {
    script: [
      {
        async: true,
        'data-domain': 'docs.index.network',
        src: 'https://plausible.io/js/script.outbound-links.js',
      },
    ],
  },
  socials: [{ icon: 'github', link: 'https://github.com/indexnetwork/index' }],
  sidebar: [
    {
      text: 'How it works',
      items: [
        { text: 'Overview', link: '/' },
        {
          text: 'Primitives',
          collapsed: true,
          items: [
            { text: 'Intent', link: '/intent' },
            { text: 'Network', link: '/network' },
            { text: 'Negotiation', link: '/negotiation' },
            { text: 'Opportunity', link: '/opportunity' },
          ],
        },
        { text: 'Discovery', link: '/discovery' },
        { text: 'Privacy', link: '/privacy' },
      ],
    },
    {
      text: 'Guides',
      items: [
        { text: 'Find someone', link: '/guides/find-someone' },
        { text: 'Custom negotiator', link: '/guides/custom-negotiator' },
        { text: 'Introducer agent (planned)', link: '/guides/introducer-agent' },
        { text: 'Group formation (planned)', link: '/guides/group-formation' },
      ],
    },
    {
      text: 'Use',
      items: [
        { text: 'CLI', link: '/use/cli' },
        { text: 'MCP', link: '/use/mcp' },
        { text: 'macOS', link: '/use/mac' },
        { text: 'Hermes Agent', link: '/use/hermes' },
      ],
    },
    {
      text: 'Integrate',
      items: [
        {
          text: 'API',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/integrate/rest' },
            { text: 'Intent', link: '/integrate/rest/intents' },
            { text: 'Network', link: '/integrate/rest/networks' },
            { text: 'Negotiations', link: '/integrate/rest/negotiations' },
            { text: 'Opportunities', link: '/integrate/rest/opportunities' },
            { text: 'Conversations', link: '/integrate/rest/conversations' },
          ],
        },
        { text: 'Host', link: '/integrate/host' },
        { text: 'Stability', link: '/integrate/stability' },
      ],
    },
  ],
})
