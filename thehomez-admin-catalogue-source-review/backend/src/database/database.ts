import mongoose, { type ConnectOptions } from 'mongoose';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/logger.js';

let isConnecting = false;
let listenersRegistered = false;

/**
 * Strips user credentials and query credentials from a MongoDB URI for safe logging.
 */
export function sanitizeMongoUri(uri: string): string {
  try {
    // Strip userinfo between // and the last @ before host:port
    return uri.replace(/\/\/(.*)@/, '//***:***@');
  } catch {
    return '[SANITIZED_URI]';
  }
}

/**
 * Registers Mongoose connection lifecycle events once.
 * Leverages the native MongoDB driver and Mongoose auto-recovery features
 * without introducing duplicate manual reconnection loops.
 */
function registerConnectionLifecycle(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connection established');
  });

  mongoose.connection.on('open', () => {
    logger.info('MongoDB connection opened and ready for queries');
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB connection lost. Awaiting automatic driver reconnect...');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected successfully');
  });

  mongoose.connection.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'MongoDB connection error encountered');
  });

  mongoose.connection.on('close', () => {
    logger.info('MongoDB connection closed');
  });
}

/**
 * Determines whether the database connection is currently healthy and ready.
 * Mongoose connection readyState:
 * 0 = disconnected
 * 1 = connected
 * 2 = connecting
 * 3 = disconnecting
 */
export function isDatabaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Returns diagnostic metadata about the current database state without leaking credentials.
 */
export function getDatabaseDiagnostics(): {
  readyState: number;
  status: 'connected' | 'connecting' | 'disconnecting' | 'disconnected';
  host?: string;
  name?: string;
} {
  const readyState = mongoose.connection.readyState;
  const statusMap: Record<number, 'disconnected' | 'connected' | 'connecting' | 'disconnecting'> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  return {
    readyState,
    status: statusMap[readyState] ?? 'disconnected',
    host: mongoose.connection.host || undefined,
    name: mongoose.connection.name || undefined,
  };
}

/**
 * Connects to MongoDB with configured pooling and timeouts.
 */
export async function connectDatabase(
  customUri?: string,
  customOptions?: ConnectOptions,
): Promise<typeof mongoose> {
  const config = getConfig();
  const uri = customUri || config.mongodb.uri;

  registerConnectionLifecycle();

  if (mongoose.connection.readyState === 1) {
    logger.debug('MongoDB already connected');
    return mongoose;
  }

  if (isConnecting) {
    logger.debug('MongoDB connection already in progress, awaiting resolution...');
    return mongoose;
  }

  const options: ConnectOptions = {
    minPoolSize: config.mongodb.minPoolSize,
    maxPoolSize: config.mongodb.maxPoolSize,
    serverSelectionTimeoutMS: config.mongodb.serverSelectionTimeoutMS,
    socketTimeoutMS: config.mongodb.socketTimeoutMS,
    connectTimeoutMS: config.mongodb.connectTimeoutMS,
    autoIndex: !config.isProduction, // Disable automatic index builds in production
    ...customOptions,
  };

  isConnecting = true;
  const safeUri = sanitizeMongoUri(uri);

  try {
    logger.info(
      {
        uri: safeUri,
        minPoolSize: options.minPoolSize,
        maxPoolSize: options.maxPoolSize,
        serverSelectionTimeoutMS: options.serverSelectionTimeoutMS,
      },
      'Connecting to MongoDB...',
    );

    const connection = await mongoose.connect(uri, options);
    isConnecting = false;
    return connection;
  } catch (error) {
    isConnecting = false;
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      { err: err.message, uri: safeUri },
      'Failed to establish initial MongoDB connection',
    );
    throw err;
  }
}

/**
 * Gracefully closes the database connection.
 */
export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  try {
    logger.info('Closing MongoDB connection...');
    await mongoose.disconnect();
    logger.info('MongoDB connection closed successfully');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err: err.message }, 'Error closing MongoDB connection');
    throw err;
  }
}
