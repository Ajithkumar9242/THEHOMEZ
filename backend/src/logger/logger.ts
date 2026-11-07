import pino, { type Logger, type LoggerOptions, type DestinationStream } from 'pino';
import { getConfig } from '../config/env.js';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'headers.authorization',
  'authorization',
  'req.headers.cookie',
  'headers.cookie',
  'cookie',
  'res.headers["set-cookie"]',
  'headers["set-cookie"]',
  'set-cookie',
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
  'token',
  '*.token',
  'refreshToken',
  '*.refreshToken',
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
