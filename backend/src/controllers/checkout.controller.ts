import type { Request, Response, NextFunction } from 'express';
import { CheckoutPreparationService } from '../services/checkout-preparation.service.js';
import { CartError } from '../services/cart/cart.errors.js';
import { IDEMPOTENCY_KEY_HEADER, type IApiResponse, type IPrepareCheckoutRequestDto, type IPrepareCheckoutResponseDto, type ICheckoutSessionDto } from '@thehomez/shared-types';

export class CheckoutController {
  constructor(private readonly service = new CheckoutPreparationService()) { this.prepare = this.prepare.bind(this); this.get = this.get.bind(this); }
  async prepare(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const key = req.get(IDEMPOTENCY_KEY_HEADER)?.trim();
      if (!key) throw new CartError('Idempotency-Key header is required', 'IDEMPOTENCY_KEY_REQUIRED', 400);
      const result = await this.service.prepare(req.customerFilter!.userId.toString(), req.body as IPrepareCheckoutRequestDto, key);
      const body: IApiResponse<IPrepareCheckoutResponseDto> = { success: true, data: result };
      res.status(result.idempotentReplay ? 200 : 201).json(body);
    } catch (e) { next(e); }
  }
  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { const data = await this.service.get(req.customerFilter!.userId.toString(), String(req.params.sessionId));
      const body: IApiResponse<ICheckoutSessionDto> = { success: true, data }; res.status(200).json(body);
    } catch (e) { next(e); }
  }
}
