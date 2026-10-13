import { isSignedMorningOff } from '../lib/app-link';
import { escapeHtml } from '../lib/escapeHtml';
import { Controller, Get, Post } from '../lib/router/router.decorators';
import { userService } from '../services/user.service';

const page = (body: string) => new Response(
  `<!doctype html><meta charset="utf-8"><body style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:14px;line-height:1.6;max-width:420px;margin:64px auto;padding:0 16px;color:#111;">${body}</body>`,
  { headers: { 'content-type': 'text/html; charset=utf-8' } },
);

const invalid = () => page('<p>This link is not valid.</p>');

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
    return page(`<p>Turn off the daily brief? Your agent will stop waking and emailing you each morning. You can turn it back on in settings.</p>
<form method="post" action="/api/unsubscribe/morning">
  <input type="hidden" name="user" value="${escapeHtml(link.user)}" />
  <input type="hidden" name="sig" value="${escapeHtml(link.sig)}" />
  <button type="submit" style="font: inherit; padding: 6px 12px;">Turn off the daily brief</button>
</form>`);
  }

  @Post('/morning')
  async turnOff(req: Request) {
    const link = await signed(req);
    if (!link) return invalid();
    await userService.updateNotificationPreferences(link.user, { morningBrief: false });
    return page("<p>Done. Your agent won't wake or email you each morning. You can turn it back on in settings.</p>");
  }
}
