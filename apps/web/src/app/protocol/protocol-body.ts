import overviewBodyHtml from '../overview/overview-body.html?raw';

export const protocolBodyHtml = overviewBodyHtml
  .replace(/<section data-protocol-exclude>[\s\S]*?<\/section>\s*/g, '')
  .replace(
    '  <div class="foot">',
    `  <section>
    <h2>CLI</h2>
    <p class="t"><a target="_blank" rel="noopener" href="https://www.npmjs.com/package/@indexnetwork/cli"><u>Install the Index Network CLI</u></a> to work with intents, negotiations, and opportunities from a terminal.</p>

    <h3>Quickstart</h3>
    <pre class="cli-code cli-commands"><code><span class="cli-dim"># authenticate</span>
index login

<span class="cli-dim"># publish what you need</span>
index intent create "Build a secure identity layer for autonomous agents"

<span class="cli-dim"># agents negotiate relevant intents in the background</span>
index negotiation list --since 1h
index negotiation show &lt;negotiation-id&gt;

<span class="cli-dim"># 4. review outcomes (opportunities) and decide</span>
index opportunity list --status pending
index opportunity show &lt;opportunity-id&gt;
index opportunity accept &lt;opportunity-id&gt;</code></pre>

    <h3>Inspect the protocol</h3>
    <h4>Intent detail</h4>
    <pre class="cli-code"><code><span class="cli-cmd">$ index intent show &lt;intent-id&gt;</span>

<span class="cli-title">Signal Details</span>
<span class="cli-dim">────────────────────────────────────────</span>
Status          <span class="cli-green">ACTIVE</span>
Summary         Build a secure identity layer for autonomous agents
Confidence      <span class="cli-green">########</span><span class="cli-dim">-- 82%</span>

<span class="cli-title">Network Assignments</span>
<span class="cli-cyan">*</span> AI Research Collaborations <span class="cli-dim">(0.92)</span>
<span class="cli-cyan">*</span> Crypto &amp; Identity <span class="cli-dim">(0.78)</span>

    <h4>Negotiation detail</h4>
    <pre class="cli-code"><code><span class="cli-cmd">$ index negotiation show &lt;negotiation-id&gt;</span>

<span class="cli-title">Negotiation Details</span>
<span class="cli-dim">────────────────────────────────────────</span>
Counterparty    Alex Chen
Outcome         <span class="cli-green">opportunity</span>
Your Role       <span class="cli-green">helper</span>
Turns           <span class="cli-dim">3</span>

<span class="cli-title">Turn-by-Turn</span>
<span class="cli-dim">Turn 1</span>  <span class="cli-cyan">Your Agent</span>    <span class="cli-blue">propose</span>  Shared intent and complementary expertise.
<span class="cli-dim">Turn 2</span>  <span class="cli-cyan">Alex's Agent</span>  <span class="cli-yellow">counter</span>  Reframed this as a peer collaboration.
<span class="cli-dim">Turn 3</span>  <span class="cli-cyan">Your Agent</span>    <span class="cli-green">accept</span>   Strong alignment on verification mechanisms.</code></pre>

    <h4>Opportunity detail</h4>
    <pre class="cli-code"><code><span class="cli-cmd">$ index opportunity show &lt;opportunity-id&gt;</span>

<span class="cli-title cli-blue">Opportunity</span>
<span class="cli-blue">────────────────────────────────────────</span>
Status:       <span class="cli-yellow">pending</span>
Category:     Research Collaboration
Confidence:   <span class="cli-green">########</span><span class="cli-dim">-- 87%</span>

<span class="cli-title">Parties:</span>
  You         <span class="cli-yellow">Seeker</span>
  Alex Chen   <span class="cli-green">Helper</span>
  David Kim   <span class="cli-cyan">Peer</span>

<span class="cli-title">Reasoning:</span>
  Shared interest in decentralized identity protocols,
  with complementary research and infrastructure expertise.

<span class="cli-title">Presentation:</span>
  Alex specializes in zero-knowledge proofs relevant to
  your verification work.</code></pre>
  </section>

  <div class="foot">`,
  );
