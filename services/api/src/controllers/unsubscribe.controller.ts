import { isSignedMorningOff } from '../lib/app-link';
import { escapeHtml } from '../lib/escapeHtml';
import { Controller, Get, Post } from '../lib/router/router.decorators';
import { userService } from '../services/user.service';

/**
 * A page outside the app, in the web app's sign-in status look: a title and a
 * grey line in a narrow centred column, plus the orange button when there is
 * something to decide.
 */
const page = (title: string, message: string, action = '') => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · index</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=JetBrains+Mono:wght@700&display=swap">
<style>
*{box-sizing:border-box}
html,body{margin:0}
body{
  min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px;
  background:#fdfdfd;color:#141414;
  font:400 13px/1.4 "IBM Plex Sans","Helvetica Neue",-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased;
}
main{width:100%;max-width:432px;display:flex;flex-direction:column;gap:24px}
h1{margin:0;font-size:22px;font-weight:600;line-height:1.3;text-wrap:pretty}
.status{display:flex;flex-direction:column;align-items:flex-start;gap:12px}
p{margin:0;font-size:13px;line-height:1.6;color:#555}
form{margin:4px 0 0}
button{
  height:34px;padding:0 16px;cursor:pointer;
  border:1px solid #000;border-radius:2px;background:#ff8a00;color:#000;
  box-shadow:inset 1px 1px 0 #ffd7a0,inset -1px -1px 0 #8a4500,1px 1px 0 rgba(0,0,0,.25);
  font:700 12px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.5px;
}
button:hover{background:#ff9d2b}
button:active{transform:translate(1px,1px);box-shadow:inset 1px 1px 0 #888,inset -1px -1px 0 #fff}
@media (max-width:600px){main{gap:20px}}
</style></head>
<body>
<main><h1>${title}</h1><div class="status"><p>${message}</p>${action}</div></main>
</body></html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8' } },
);

const invalid = () => page("this link doesn't work", 'it may be cut off or out of date. you can turn the daily brief off in settings instead.');

/** The user and signature, from the query string or a posted form. */
async function signed(req: Request): Promise<{ user: string; sig: string } | null> {
  const url = new URL(req.url);
  let user = url.searchParams.get('user') ?? '';
  let sig = url.searchParams.get('sig') ?? '';
  if (!user || !sig) {
    const form = new URLSearchParams(await req.text());
    user = form.get('user') ?? '';
    sig = form.get('sig') ?? '';
  }
  return user && isSignedMorningOff(user, sig) ? { user, sig } : null;
}

/**
 * Turns the daily brief off from a signed link. The page itself changes
 * nothing; confirming, or a mail client's one-click unsubscribe, does.
 */
@Controller('/unsubscribe')
export class UnsubscribeController {
  @Get('/morning')
  async show(req: Request) {
    const link = await signed(req);
    if (!link) return invalid();
    return page(
      'turn off the daily brief?',
      'your agent will stop waking and emailing you each morning. you can turn it back on in settings.',
      `<form method="post" action="/api/unsubscribe/morning">
  <input type="hidden" name="user" value="${escapeHtml(link.user)}" />
  <input type="hidden" name="sig" value="${escapeHtml(link.sig)}" />
  <button type="submit">turn off</button>
</form>`,
    );
  }

  @Post('/morning')
  async turnOff(req: Request) {
    const link = await signed(req);
    if (!link) return invalid();
    await userService.updateNotificationPreferences(link.user, { morningBrief: false });
    return page('the daily brief is off', "your agent won't wake or email you each morning. you can turn it back on in settings.");
  }
}
