import pino, { type Logger, type LoggerOptions, type DestinationStream } from 'pino';
import { getConfig } from '../config/env.js';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.Authorization',
  'headers.authorization',
  'headers.Authorization',
  'authorization',
  'Authorization',
  '*.authorization',
  '*.Authorization',
  '*.*.authorization',
  '*.*.Authorization',
  'req.headers.cookie',
  'req.headers.Cookie',
  'headers.cookie',
  'headers.Cookie',
  'cookie',
  'Cookie',
  '*.cookie',
  '*.Cookie',
  '*.*.cookie',
  '*.*.Cookie',
  'req.cookies',
  'cookies',
  '*.cookies',
  'res.headers["set-cookie"]',
  'res.headers["Set-Cookie"]',
  'headers["set-cookie"]',
  'headers["Set-Cookie"]',
  'set-cookie',
  'Set-Cookie',
  'req.headers["x-cart-session-token"]',
  'req.headers["X-Cart-Session-Token"]',
  'headers["x-cart-session-token"]',
  'headers["X-Cart-Session-Token"]',
  '["x-cart-session-token"]',
  '["X-Cart-Session-Token"]',
  '*["x-cart-session-token"]',
  '*["X-Cart-Session-Token"]',
  'password',
  '*.password',
  '*.*.password',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'otp',
  '*.otp',
  'code',
  'verificationCode',
  'accessToken',
  '*.accessToken',
  '*.*.accessToken',
  'access_token',
  '*.access_token',
  'token',
  '*.token',
  '*.*.token',
  'refreshToken',
  '*.refreshToken',
  '*.*.refreshToken',
  'refresh_token',
  '*.refresh_token',
  '*.*.refresh_token',
  'refreshTokenHash',
  '*.refreshTokenHash',
  'thz_refresh_token',
  '*.thz_refresh_token',
  'guestSessionToken',
  '*.guestSessionToken',
  '*.*.guestSessionToken',
  'cartSessionToken',
  '*.cartSessionToken',
  '*.*.cartSessionToken',
  'sessionToken',
  '*.sessionToken',
  '*.*.sessionToken',
  'sessionTokenHash',
  '*.sessionTokenHash',
  'cartToken',
  '*.cartToken',
  'guestCartToken',
  '*.guestCartToken',
  'thz_guest_cart_token',
  '*.thz_guest_cart_token',
  'cardNumber',
  'cvv',
  'cvc',
  'expiry',
  'paymentDetails',
  'razorpay_signature',
  'MONGODB_URI',
  'mongoUri',
  'uri',
  'connectionString',
  '*.MONGODB_URI',
  '*.mongoUri',
  '*.uri',
  '*.connectionString',
  'JWT_ACCESS_SECRET',
  'OTP_PEPPER_SECRET',
  'MSG91_AUTH_KEY',
  '*.JWT_ACCESS_SECRET',
  '*.OTP_PEPPER_SECRET',
  '*.MSG91_AUTH_KEY',
  'accessSecret',
  'refreshSecret',
  'pepperSecret',
  'authKey',
  '*.accessSecret',
  '*.refreshSecret',
  '*.pepperSecret',
  '*.authKey',
];

export function createLogger(
  options: Partial<LoggerOptions> = {},
  destination?: DestinationStream,
): Logger {
  const config = getConfig();

  const baseOptions: LoggerOptions = {
    level: options.level ?? config.logging.level,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: config.isProduction ? { pid: process.pid } : undefined,
    ...options,
  };

  // If a destination stream or transport is explicitly provided, use it
  if (destination) {
    return pino(baseOptions, destination);
  }

  // Use pino-pretty in development mode when writing to stdout
  if (config.isDevelopment && !options.transport) {
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(baseOptions);
}

export const logger = createLogger();
