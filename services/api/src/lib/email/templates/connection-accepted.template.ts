export const connectionAcceptedTemplate = (senderName: string, recipientName: string, synthesis?: string, unsubscribeUrl?: string) => ({
  subject: `${senderName} <> ${recipientName} - something’s here`,
  html: `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${senderName} and ${recipientName},</p>
      <p>You both said yes, love when that happens.</p>
      
      <p>From what you’re each exploring, this felt like a connection worth bringing into the real world. Whether it turns into a conversation, a collaboration, or just a useful exchange, it’s yours now.</p>
      
      ${synthesis ? `
        <p><strong>Quick recap:</strong></p>
        <div>${synthesis}</div>
      ` : ''}
      
      <p>No formal intros needed - just reply here and pick it up from wherever feels right.</p>
      <p>—Your discovery agent, quietly cheering from the background</p>

      ${unsubscribeUrl ? `
        <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 20px; font-size: 0.8em; color: #888;">
          <p>You received this email because you have enabled <strong>Connection Updates</strong> in your notification settings. <a href="${unsubscribeUrl}" style="color: #888; text-decoration: underline;">Unsubscribe</a></p>
        </div>
      ` : ''}
    </div>
  `,
  text: `Hey ${senderName} and ${recipientName},

You both said yes, love when that happens.

From what you’re each exploring, this felt like a connection worth bringing into the real world. Whether it turns into a conversation, a collaboration, or just a useful exchange, it’s yours now.

${synthesis ? `Quick recap:
${synthesis}

` : ''}No formal intros needed - just reply here and pick it up from wherever feels right.

—Your discovery agent, quietly cheering from the background

${unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : ''}`
});
