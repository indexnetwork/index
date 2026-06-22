import { escapeHtml } from "../../escapeHtml";

export interface Match {
  name: string;
  role?: string;
  reasoning: string;
}

export const weeklyNewsletterTemplate = (recipientName: string, matches: Match[], unsubscribeUrl?: string) => {

  const formatReasoning = (text: string) => {
    return escapeHtml(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  }

  const matchesHtml = matches.map((match) => `
    <div style="margin-bottom: 20px;">
      <p><strong>${escapeHtml(match.name)}${match.role ? ` — <em>${escapeHtml(match.role)}</em>` : ''}</strong></p>
      <p>${formatReasoning(match.reasoning)}</p>
    </div>
  `).join('');

  const matchesText = matches.map((match) => `
${match.name}${match.role ? ` — ${match.role}` : ''}
${match.reasoning}
  `).join('\n');

  const subject = `You’ve got ${matches.length} conversations waiting in your Index Inbox`;

  return {
    subject,
    html: `
      <div style="font-family: Arial, sans-serif;">
        <p>Hey ${recipientName},</p>
        <p>Index’s agents surfaced a few people this week whose work lines up unusually well with the things you’re pushing right now - fundraising, agent deployments, protocol scaling, semantic web thinking, and the early shape of a discovery network.</p>
        <p>Each one can shift something forward - choose your move, and I’ll take the next step with you.</p>
        
        <div style="margin: 20px 0;">
          <a href="https://index.network/inbox" style="text-decoration: none; font-weight: bold; color: #FFFFFF; background-color: #0A0A0A; font-size: 1.1em; padding: 10px 20px; border-radius: 5px; display: inline-block;">Go to your Inbox</a>
        </div>
        
        ${matchesHtml}
        
        <div style="margin: 20px 0;">
          <a href="https://index.network/inbox" style="text-decoration: none; font-weight: bold; color: #FFFFFF; background-color: #0A0A0A; font-size: 1.1em; padding: 10px 20px; border-radius: 5px; display: inline-block;">Go to your Inbox</a>
        </div>
        
        <p>—Index, keeping your next moves within reach</p>

        ${unsubscribeUrl ? `
          <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px; font-size: 0.8em; color: #888;">
            <p>You received this email because you have enabled <strong>Weekly Newsletter</strong> in your notification settings. <a href="${unsubscribeUrl}" style="color: #888; text-decoration: underline;">Unsubscribe</a></p>
          </div>
        ` : ''}
        
        <div style="margin-top: 20px; text-align: center;">
            <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
        </div>
      </div>
    `,
    text: `Hey ${recipientName},

Index’s agents surfaced a few people this week whose work lines up unusually well with the things you’re pushing right now - fundraising, agent deployments, protocol scaling, semantic web thinking, and the early shape of a discovery network.

Each one can shift something forward - choose your move, and I’ll take the next step with you.

👉 Go to your Inbox: https://index.network/inbox

${matchesText}

👉 Go to your Inbox: https://index.network/inbox

—Index, keeping your next moves within reach

${unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : ''}`
  };
};
