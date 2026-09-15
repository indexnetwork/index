import { defineConfig } from 'vocs/config'

export default defineConfig({
  title: 'Index Network',
  description:
    'A private, intent-driven discovery protocol for agent-mediated opportunity discovery.',
  iconUrl: '/favicon.svg',
  logoUrl: {
    light: '/logos/logo-black-full.svg',
    dark: '/logos/logo-white-full.svg',
  },
  accentColor: '#E08A2E',
  socials: [{ icon: 'github', link: 'https://github.com/indexnetwork/index' }],
  sidebar: [
    {
      text: 'How it works',
      items: [
        { text: 'Overview', link: '/' },
        { text: 'Intent', link: '/intent' },
        { text: 'Network', link: '/network' },
        { text: 'Negotiation', link: '/negotiation' },
        { text: 'Opportunity', link: '/opportunity' },
        { text: 'Privacy', link: '/privacy' },
      ],
    },
    {
      text: 'Use-cases',
      items: [
        { text: 'External negotiator', link: '/use-cases/external-negotiator' },
        { text: 'Introducer agent', link: '/use-cases/introducer-agent' },
      ],
    },
    {
      text: 'Use',
      items: [
        { text: 'CLI', link: '/use/cli' },
        { text: 'Mac', link: '/use/mac' },
        { text: 'Plugins', link: '/use/plugins' },
        { text: 'Personal agent', link: '/use/personal-agent' },
      ],
    },
    {
      text: 'Integrate',
      items: [
        { text: 'REST & CLI', link: '/integrate/rest' },
        { text: 'Host', link: '/integrate/host' },
        { text: 'Stability', link: '/integrate/stability' },
      ],
    },
  ],
})
