import { URL } from 'node:url';

export const ADMIN_PROVISIONING_DATABASE = 'thehomez_admin_verify';

export function validateAdminProvisioningEnvironment(
  loadedEnvironment,
  environment,
  invocationNodeEnv,
) {
  const mongoUri = environment.MONGODB_URI;
  if (
    invocationNodeEnv === 'production' ||
    loadedEnvironment.error ||
    !loadedEnvironment.parsed ||
    !Object.hasOwn(loadedEnvironment.parsed, 'MONGODB_URI') ||
    !mongoUri?.trim() ||
    environment.NODE_ENV !== 'development' ||
    environment.PORT !== '5001'
  ) {
    return false;
  }

  try {
    const parsedUri = new URL(mongoUri);
    return (
      ['mongodb:', 'mongodb+srv:'].includes(parsedUri.protocol) &&
      parsedUri.pathname === `/${ADMIN_PROVISIONING_DATABASE}` &&
      [...parsedUri.searchParams].every(
        ([key, value]) => key.toLowerCase() !== 'dbname' || value === ADMIN_PROVISIONING_DATABASE,
      )
    );
  } catch {
    return false;
  }
}

export function assertProvisioningTargetsAvailable(existingUser, existingRole) {
  if (existingUser || existingRole) {
    throw new Error('A matching account or role already exists; nothing was overwritten.');
  }
}

export function assertConnectedAdminDatabase(diagnostics) {
  if (diagnostics?.status !== 'connected' || diagnostics?.name !== ADMIN_PROVISIONING_DATABASE) {
    throw new Error('Connected database did not match the isolated target.');
  }
}
