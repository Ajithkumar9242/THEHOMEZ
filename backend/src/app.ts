import express, { type Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { getConfig } from './config/env.js';
import { correlationIdMiddleware } from './middleware/correlation-id.js';
import { requestLoggerMiddleware } from './middleware/request-logger.js';
import { notFoundHandler, errorHandlerMiddleware } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { serviceAreaRouter } from './routes/service-area.routes.js';
import { partnerRouter } from './routes/partner.routes.js';
import { categoryRouter } from './routes/category.routes.js';
import { productRouter } from './routes/product.routes.js';
import { unitRouter } from './routes/unit.routes.js';
import { pricingRouter } from './routes/pricing.routes.js';
import {
  partnerAvailabilityRouter,
  adminPartnerAvailabilityRouter,
} from './routes/partner-availability.routes.js';
import { storefrontRouter } from './routes/storefront.routes.js';

/**
 * Creates and configures the Express application.
 */
export function createApp(): Application {
  const config = getConfig();
  const app: Application = express();

  // Basic security headers
  app.use(helmet());

  // Cross-Origin Resource Sharing
  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id', 'X-Request-Id'],
      exposedHeaders: ['X-Correlation-Id'],
    }),
  );

  // Body parsers with defensive size limits
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Request correlation tracking and logging
  app.use(correlationIdMiddleware);
  app.use(requestLoggerMiddleware);

  // Health and readiness endpoints
  app.use(`${config.apiPrefix}/health`, healthRouter);

  // Authentication & Identity endpoints
  app.use(`${config.apiPrefix}/auth`, authRouter);

  // Service Area & Geography endpoints
  app.use(`${config.apiPrefix}/service-areas`, serviceAreaRouter);

  // Partner endpoints
  app.use(`${config.apiPrefix}/partners`, partnerRouter);

  // Product Taxonomy: Categories and Subcategories
  app.use(`${config.apiPrefix}/categories`, categoryRouter);

  // Master Product Catalogue & Variants
  app.use(`${config.apiPrefix}/products`, productRouter);

  // Construction Units of Measure Master & Governance
  app.use(`${config.apiPrefix}/units`, unitRouter);

  // Authoritative Catalogue Pricing & Calculation Engine
  app.use(`${config.apiPrefix}/pricing`, pricingRouter);

  // Partner Product Availability management & Storefront Resolution
  app.use(`${config.apiPrefix}/partner/availability`, partnerAvailabilityRouter);
  app.use(`${config.apiPrefix}/admin/partners`, adminPartnerAvailabilityRouter);

  // Consumer Storefront Discovery & Browsing
  app.use(`${config.apiPrefix}/storefront`, storefrontRouter);

  // Unmatched route handler (404)
  app.use(notFoundHandler);

  // Central error handling middleware
  app.use(errorHandlerMiddleware);

  return app;
}
