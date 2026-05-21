import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { profileService } from '../services/profile.service';
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';

const logger = log.controller.from('profile');

@Controller('/profiles')
export class ProfileController {
  /**
   * Syncs/Generates a profile for the given user.
   * This is the main entry point to trigger the profile graph.
   */
  @Post('/sync')
  @UseGuards(RateLimit('write'), AuthGuard)
  async sync(req: Request, user: AuthenticatedUser) {
    logger.verbose('Profile sync requested', { userId: user.id });
    
    const result = await profileService.syncProfile(user.id);

    return Response.json(result);
  }
}
