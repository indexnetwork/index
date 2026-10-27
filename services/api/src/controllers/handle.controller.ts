import { Controller, Get } from '../lib/router/router.decorators';
import { handleService } from '../services/handle.service';

/**
 * `index.network/<handle>`: one namespace for usernames and network keys.
 * Public, so a shared link resolves for signed-out visitors too.
 */
@Controller('/handles')
export class HandleController {
  /**
   * GET /handles/:handle — whose page a root link opens.
   *
   * @returns `{ kind: 'user', id }`, or `{ kind: 'network', id, title,
   *   imageUrl, joinPolicy }` (the title is shown even for invite-only
   *   networks; nothing else about them is), or 404.
   */
  @Get('/:handle')
  async resolve(_req: Request, _user: unknown, params: { handle: string }) {
    const holder = await handleService.resolve(params.handle);
    if (!holder) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    return Response.json({ handle: holder });
  }
}
