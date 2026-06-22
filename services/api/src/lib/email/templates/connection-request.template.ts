export const connectionRequestTemplate = (fromUserName: string, toUserName: string, synthesis?: string, subject?: string, unsubscribeUrl?: string) => {
  // Simple helper to strip HTML tags for the text version
  const stripHtml = (html: string) => {
    return html.replace(/<[^>]*>?/gm, '');
  };

  const textSynthesis = synthesis ? stripHtml(synthesis) : undefined;

  return {
    subject: subject || `✨ ${fromUserName} wants to connect with you`,
    html: `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${toUserName},</p>
      <p>You’ve got a new connection request on Index, <strong>${fromUserName}</strong> wants to connect with you.</p>
      
      <div style="margin: 20px 0;">
        <a href="https://index.network/inbox" style="text-decoration: none; font-weight: bold; color: #FFFFFF; background-color: #0A0A0A; font-size: 1.1em; padding: 10px 20px; border-radius: 5px; display: inline-block;">Go to Index to approve</a>
      </div>
      
      ${synthesis ? `
        <p><strong>What could happen between you two:</strong></p>
        <div>${synthesis}</div>
      ` : ''}
      
      <p>If you want to move it forward, I’ll make the introduction. If not, everything stays quiet.</p>
      <p>—Index</p>

      ${unsubscribeUrl ? `
        <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px; font-size: 0.8em; color: #888;">
          <p>You received this email because you have enabled <strong>Connection Updates</strong> in your notification settings. <a href="${unsubscribeUrl}" style="color: #888; text-decoration: underline;">Unsubscribe</a></p>
        </div>
      ` : ''}

      <div style="margin-top: 20px; text-align: center;">
          <img src="https://index.network/logo.png" alt="Index" style="height: 24px; opacity: 0.5;" />
      </div>
    </div>
          `,
    // Clean text version
    text: `Hey ${toUserName},

  You’ve got a new connection request on Index, ${fromUserName} wants to connect with you.

👉 Go to Index to approve: https://index.network/inbox

${textSynthesis ? `What could happen between you two:
${textSynthesis}

` : ''
      }If you want to move it forward, I'll make the introduction. If not, everything stays quiet.

—Index

${unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : ''} `
  };
};
