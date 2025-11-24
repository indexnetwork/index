import { traceableLlm } from "../../../lib/agents";
import { format } from 'timeago.js';

// Type definitions
export interface VibeCheckResult {
  success: boolean;
  synthesis?: string;
  error?: string;
  timing?: { startTime: Date; endTime: Date; durationMs: number };
}

export interface VibeCheckOptions {
  timeout?: number;
  characterLimit?: number;
}

export interface IntentWithTime {
  id: string;
  payload: string;
  createdAt: Date;
}

export interface IntentPair {
  stake: number;
  contextUserIntent: IntentWithTime;
  targetUserIntent: IntentWithTime;
}

export interface OtherUserData {
  id: string;
  name: string;
  intro: string;
  intentPairs: IntentPair[];
  initiatorName?: string;
}

/**
 * Generate collaboration synthesis showing why two people are mutual matches
 */
export async function vibeCheck(
  data: OtherUserData,
  opts: VibeCheckOptions = {}
): Promise<VibeCheckResult> {
  const startTime = new Date();
  
  try {
    if (!data?.intentPairs?.length) {
      return {
        success: false,
        error: 'No intent pairs provided',
        timing: getTiming(startTime)
      };
    }

    const { timeout = 30000, characterLimit } = opts;
    const isThirdPerson = !!data.initiatorName;
    const initiator = data.initiatorName || 'you';
    const target = data.name;

    // System prompt
    const systemMsg = buildSystemMessage(initiator, target, isThirdPerson, characterLimit);
    
    // User prompt with intent pairs
    const userMsg = buildUserMessage(data, initiator, target, isThirdPerson);

    
    // Execute vibe check with timeout
    /*
    const response = await Promise.race([
      traceableLlm("vibe-checker", {
        other_user_id: data.id,
        other_user_name: data.name,
        intent_pairs_count: data.intentPairs.length
      })([systemMsg, userMsg], { reasoning: { exclude: true, effort: 'minimal' } }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Vibe check timeout')), timeout)
      )
    ]);
    */
    const response = await traceableLlm("vibe-checker", {
      other_user_id: data.id,
      other_user_name: data.name,
      intent_pairs_count: data.intentPairs.length
    })([systemMsg, userMsg], { reasoning: { exclude: true, effort: 'minimal' } });

    const synthesis = (response.content as string).trim();

    return {
      success: true,
      synthesis,
      timing: getTiming(startTime)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timing: getTiming(startTime)
    };
  }
}

// Helper functions
function getTiming(startTime: Date) {
  const endTime = new Date();
  return {
    startTime,
    endTime,
    durationMs: endTime.getTime() - startTime.getTime()
  };
}

function buildSystemMessage(
  initiator: string,
  target: string,
  isThirdPerson: boolean,
  characterLimit?: number
) {
  return {
    role: "system",
    content: `You are a collaboration synthesis generator. Create a warm, practical paragraph explaining why two people are mutual matches based on what they're explicitly looking for.

Style:
- Warm and friendly, not formal (we're introducing humans, not robots)
- Grounded in stated needs (state what they're explicitly looking for, not speculative "could do" scenarios)
- Direct and concise
- Add a small human touch—a light joke, casual aside, or relatable moment. Keep it natural, like you're telling a friend about this match.

Format:
- Markdown with 2-3 inline hyperlinks: [descriptive phrase](https://index.network/intents/ID)
- ONLY hyperlink ${isThirdPerson ? `${initiator}'s` : 'your'} intents - NEVER link ${target}'s intents
- Link natural phrases like "UX designers crafting interfaces" not "UX designers (link)"
- Place links in beginning/middle of paragraph, not at the end
- No bold, italic, or title${characterLimit ? `\n- Maximum ${characterLimit} characters` : ''}

Time Awareness:
- Each intent includes a <created> timestamp (e.g., "2 months ago", "3 days ago")
- Only mention timing when it adds meaningful value:
  - Timing contrast (fresh need meets years of experience)
  - Target's dedication (been working on this for months)
  - Urgency from target (launching soon, ready now)
- Skip mentioning ${isThirdPerson ? `${initiator}'s` : 'your'} fresh timestamps—they're noise unless creating contrast
- Use timing naturally in the flow, not as a parenthetical afterthought

Structure:
- Start with what ${initiator} ${isThirdPerson ? 'is' : 'are'} explicitly looking for
- State what ${target} provides or is looking for
- Explain the mutual fit using present tense and direct language
- Weave in timing references naturally where relevant
- Address ${isThirdPerson ? `${initiator} and ${target} in third person` : `reader as "${initiator}" vs the other person by first name only`}
- Single paragraph, can use line breaks`
  };
}

function buildUserMessage(
  data: OtherUserData,
  initiator: string,
  target: string,
  isThirdPerson: boolean
) {
  const pairsXml = data.intentPairs
    .slice(0, 3)
    .map((pair, i) => {
      const contextLabel = isThirdPerson ? `${initiator}_intent` : 'your_intent';
      const targetLabel = `${target.toLowerCase().replace(/\s+/g, '_')}_intent`;
      
      return `  <pair_${i + 1}>
    <${contextLabel} id="${pair.contextUserIntent.id}">
      <what_they_want>${pair.contextUserIntent.payload}</what_they_want>
      <created>${format(pair.contextUserIntent.createdAt)}</created>
    </${contextLabel}>
    <${targetLabel} id="${pair.targetUserIntent.id}">
      <what_they_want>${pair.targetUserIntent.payload}</what_they_want>
      <created>${format(pair.targetUserIntent.createdAt)}</created>
    </${targetLabel}>
  </pair_${i + 1}>`;
    })
    .join('\n');

  const pronoun = isThirdPerson ? 'is' : 'are';
  const needs = isThirdPerson ? 'needs' : 'need';

  return {
    role: "user",
    content: `Generate collaboration synthesis between ${initiator} ${isThirdPerson ? `and ${target}` : `(authenticated user) and ${target}`}.

<other_person>
  <name>${target}</name>
  <bio>${data.intro}</bio>
</other_person>

<intent_pairs>
${pairsXml}
</intent_pairs>

Note: Use the actual <created> timestamps from the intent pairs above. The examples show timing references - yours should reflect the real data.

<examples>
  <good>"${initiator} ${needs} [help scaling APIs](https://index.network/intents/ID) and ${target} has scaled infrastructure at three startups. They have the exact backend expertise ${isThirdPerson ? initiator + ' is' : "you're"} looking for."</good>
  
  <good>"${initiator} ${isThirdPerson ? 'wants' : 'want'} to [build better dashboards](https://index.network/intents/ID) and ${target} is obsessed with data viz. They've got the visual design expertise ${isThirdPerson ? initiator + ' is' : "you're"} looking for (shocking how rare this combo is)."</good>
  
  <good>"${initiator} ${pronoun} building [DAO governance tools](https://index.network/intents/ID) and ${target} researches token-based coordination. ${isThirdPerson ? `${initiator}'s` : 'Your'} implementation focus matches their research—exactly the kind of theory-practice bridge both sides need."</good>
  
  <good>"${initiator} ${pronoun} working on [AI safety alignment](https://index.network/intents/ID) and ${target} writes about formal verification methods (been at this for years). ${isThirdPerson ? 'They complement' : 'You complement'} each other—practical implementation meets theoretical rigor, pretty rare combo."</good>
  
  <good>"${target} runs community events for developers and ${initiator} ${needs} [beta testers](https://index.network/intents/ID). They have exactly the developer audience ${isThirdPerson ? initiator + ' is' : "you're"} trying to reach."</good>
  
  <good>"Alice wants [fundraising advice](https://index.network/intents/ID) and Maya has backed 40+ startups (been investing for 5 years). Alice needs exactly what Maya's spent years learning—the timing contrast actually helps here."</good>
  
  <good>"${initiator} ${pronoun} looking for [someone to jam on music](https://index.network/intents/ID) and ${target} built a collaborative music app. They're actively looking for musicians to test it with."</good>
  
  <good>"${initiator} ${isThirdPerson ? 'wants' : 'want'} to [understand Web3 gaming economics](https://index.network/intents/ID) and ${target} designed token systems for three games. They're looking to advise people getting into the space—perfect fit."</good>
  
  <good>"${initiator} ${pronoun} researching [carbon credit verification](https://index.network/intents/ID) and ${target} is building climate impact dashboards. They both need data infrastructure—should probably just collaborate (finally, someone in the same niche)."</good>
  
  <good>"${initiator} ${needs} [visual branding](https://index.network/intents/ID) and ${target} specializes in minimal brand systems. ${isThirdPerson ? 'They offer' : 'They offer'} exactly the clean aesthetic ${isThirdPerson ? initiator + ' described' : 'you described'}—hard to find designers who get that less-is-more thing."</good>
  
  <good>"${initiator} ${pronoun} [automating deployment pipelines](https://index.network/intents/ID) (been stuck on this for months) and ${target} lives in CI/CD tooling. They know the exact pain points ${isThirdPerson ? initiator + ' is' : "you're"} hitting."</good>
  
  <good>"${initiator} ${isThirdPerson ? 'wants' : 'want'} to [study emergent behavior in markets](https://index.network/intents/ID) and ${target} has simulation frameworks ready to go. Perfect timing—research question meets tooling (rare to find both at once)."</good>
  
  <good>"Dev needs a [technical co-founder](https://index.network/intents/ID) for a fintech startup and Priya is looking for early-stage projects. Dev's vision matches Priya's 5 years of backend experience—the co-founder search is brutal, this is the kind of match that actually works."</good>
  
  <good>"${initiator} ${needs} [help with content strategy](https://index.network/intents/ID) and ${target} is a content strategist with 50+ clients. They specialize in technical content—exactly ${isThirdPerson ? initiator + "'s" : 'your'} domain."</good>
  
  <good>"Jordan is building [treasury management tools](https://index.network/intents/ID) (been iterating for 4 months) and Sam researches on-chain governance patterns. Jordan's building what Sam's been studying—that theory-implementation loop is gold."</good>
  
  <good>"${initiator} ${pronoun} [organizing a developer conference](https://index.network/intents/ID) (happening in 2 months) and ${target} is looking for speaking gigs. Perfect match—${isThirdPerson ? 'they need' : 'you need'} speakers, they want stages (it's almost too obvious)."</good>
  
  <good>"${initiator} ${needs} [growth marketing tactics](https://index.network/intents/ID) and ${target} has grown 6 products from 0 to 100k users. They know the playbook ${isThirdPerson ? initiator + ' needs' : 'you need'}."</good>
  
  <good>"${initiator} ${pronoun} [building observability infrastructure](https://index.network/intents/ID) (started 6 months ago, gaining traction) and ${target} wants to contribute to monitoring tools. ${isThirdPerson ? 'They want' : 'You want'} contributors, they want to contribute—timing's right for this to work."</good>
  
  <good>"Emma hosts a [podcast about indie makers](https://index.network/intents/ID) and is looking for guests, while Leo just launched his third side project (now profitable). Emma needs exactly Leo's story—scrappy builder who actually ships."</good>
  
  <good>"${initiator} ${isThirdPerson ? 'wants' : 'want'} to [measure social impact](https://index.network/intents/ID) and ${target} has frameworks for impact metrics. They've done the hard work of figuring out what actually matters—saves ${isThirdPerson ? initiator : 'you'} months of wandering."</good>
</examples>`
  };
}
