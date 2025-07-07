export const connectionRequestTemplate = (fromUserName: string) => ({
  subject: `${fromUserName} wants to connect on Index`,
  html: `
    <div style="font-family: Arial, sans-serif;">
      <h2>New Connection Request</h2>
      <p><strong>${fromUserName}</strong> wants to connect with you on Index.</p>
      <p>Log in to your Index account to accept or decline this request.</p>
      <a href="https://index.network/connections" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Request</a>
    </div>
  `,
  text: `New Connection Request

${fromUserName} wants to connect with you on Index.

Log in to your Index account to accept or decline this request.

View Request: https://index.network/connections`
});

export const connectionAcceptedTemplate = (toUserName: string) => ({
  subject: `${toUserName} accepted your connection request`,
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Connection Accepted!</h2>
      <p><strong>${toUserName}</strong> has accepted your connection request.</p>
      <p>You can now collaborate and share insights on Index.</p>
      <a href="https://index.network/connections" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Connections</a>
    </div>
  `,
  text: `Connection Accepted!

${toUserName} has accepted your connection request.

You can now collaborate and share insights on Index.

View Connections: https://index.network/connections`
});

export const connectionDeclinedTemplate = (toUserName: string) => ({
  subject: `Connection request declined`,
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Connection Request Update</h2>
      <p>Your connection request was declined.</p>
      <p>Continue exploring and connecting with others on Index.</p>
      <a href="https://index.network" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Explore Index</a>
    </div>
  `,
  text: `Connection Request Update

Your connection request was declined.

Continue exploring and connecting with others on Index.

Explore Index: https://index.network`
}); 