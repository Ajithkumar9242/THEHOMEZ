import type { Logger } from 'pino';
import type { IUserPrincipal } from '@thehomez/shared-types';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      log: Logger;
      user?: IUserPrincipal;
      partnerFilter?: {
        partnerId: string;
      };
    }
  }
}
