export const connectionRequestTemplate = (fromUserName: string, toUserName: string, synthesis?: string) => ({
  subject: `✨ ${fromUserName} wants to connect`,
  html: `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${toUserName},</p>
      <p>You've got a connection request on Index — ${fromUserName} asked to be introduced.</p>
      <p>👉 <a href="https://index.network/inbox" style="color: #007bff; text-decoration: none;">View the connection on Index</a></p>
      
      ${synthesis ? `
        <p><strong>Here's the vibe:</strong></p>
        <p>${synthesis}</p>
      ` : ''}
      
      <p>If you're curious, I'll make the intro — no pressure, no awkwardness.</p>
      <p>—Your quietly enthusiastic discovery agent 🤓</p>
      
      <div style="margin-top: 30px;">
        <a href="https://index.network/inbox" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Go to Index</a>
      </div>
    </div>
  `,
  text: `Hey ${toUserName},

You've got a connection request on Index — ${fromUserName} asked to be introduced.

👉 Jump to Index to see why this connection makes sense: https://index.network/inbox

${synthesis ? `Here's the vibe:
${synthesis}

` : ''}If you're curious, I'll make the intro — no pressure, no awkwardness.

—Your quietly enthusiastic discovery agent 🤓

Go to Index: https://index.network/inbox`
});

export const connectionAcceptedTemplate = (senderName: string, recipientName: string, synthesis?: string) => ({
  subject: `You're connected! ${senderName} ↔ ${recipientName}`,
  html: `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${senderName} and ${recipientName},</p>
      <p>You both said yes — love when that happens.</p>
      
      ${synthesis ? `
        <div>
          ${synthesis}
        </div>
      ` : ''}
      
      <p>No formal intros needed — just reply here and take it from wherever feels right.</p>
      <p>—Your discovery agent, quietly cheering from the background</p>
    </div>
  `,
  text: `Hey ${senderName} and ${recipientName},

You both said yes — love when that happens.

${synthesis ? `${synthesis}

` : ''}No formal intros needed — just reply here and take it from wherever feels right.

—Your discovery agent, quietly cheering from the background`
});

export const connectionDeclinedTemplate = (senderName: string) => ({
  subject: `No connection this time — and that's totally fine`,
  html: `
    <div style="font-family: Arial, sans-serif;">
      <p>Hey ${senderName},</p>
      <p>Just a quick note — your connection request isn't looking to connect right now.</p>
      <p>No worries at all. Timing, focus, or energy — lots of reasons a connection might not land. But your intent is still active, and we'll keep an eye out for others who truly align with what you're exploring.</p>
      <p>Want to tweak your signal or shift your focus? You can always update it on Index.</p>
      <p>Thanks for putting yourself out there — the right ones do find their way.</p>
      <p>—Your discovery agent, always listening</p>
      
      <div style="margin-top: 30px;">
        <a href="https://index.network" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Update on Index</a>
      </div>
    </div>
  `,
  text: `Hey ${senderName},

Just a quick note — your connection request isn't looking to connect right now.

No worries at all. Timing, focus, or energy — lots of reasons a connection might not land. But your intent is still active, and we'll keep an eye out for others who truly align with what you're exploring.

Want to tweak your signal or shift your focus? You can always update it on Index.

Thanks for putting yourself out there — the right ones do find their way.

—Your discovery agent, always listening

Update on Index: https://index.network`
}); 