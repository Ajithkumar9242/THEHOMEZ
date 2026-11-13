import { Router } from 'express';
import {
  addressIdParamSchema,
  createCustomerAddressSchema,
  updateCustomerAddressSchema,
} from '@thehomez/shared-types';
import {
  authenticate,
  requireCustomerPrincipal,
  createApiRateLimiter,
  validateBody,
  validateParams,
} from '../middleware/index.js';
import { CustomerAddressController } from '../controllers/customer-address.controller.js';

/**
 * Customer Delivery Site Address Book Router
 *
 * Base path: /api/v1/customer/addresses
 *
 * All routes enforce:
 * 1. API rate limiting
 * 2. Bearer JWT authentication (authenticate)
 * 3. Active CUSTOMER principal & anti-spoofing (requireCustomerPrincipal -> req.customerFilter)
 * 4. Strict shared Zod schema validation (.strict() body & ObjectId params)
 */
export function createCustomerAddressRouter(controller?: CustomerAddressController): Router {
  const router = Router();
  const addressController = controller || new CustomerAddressController();
  const apiLimiter = createApiRateLimiter();

  router.get(
    '/',
    apiLimiter,
    authenticate,
    requireCustomerPrincipal,
    addressController.listAddresses,
  );

  router.post(
    '/',
    apiLimiter,
    authenticate,
    requireCustomerPrincipal,
    validateBody(createCustomerAddressSchema),
    addressController.createAddress,
  );

  router.get(
    '/:addressId',
    apiLimiter,
    authenticate,
    requireCustomerPrincipal,
    validateParams(addressIdParamSchema),
    addressController.getAddressById,
  );

  router.put(
    '/:addressId',
    apiLimiter,
    authenticate,
    requireCustomerPrincipal,
    validateParams(addressIdParamSchema),
    validateBody(updateCustomerAddressSchema),
    addressController.updateAddress,
  );

  router.patch(
    '/:addressId/default',
    apiLimiter,
    authenticate,
    requireCustomerPrincipal,
    validateParams(addressIdParamSchema),
    addressController.setDefaultAddress,
  );

  router.delete(
    '/:addressId',
    apiLimiter,
    authenticate,
    requireCustomerPrincipal,
    validateParams(addressIdParamSchema),
    addressController.deleteAddress,
  );

  return router;
}

export const customerAddressRouter = createCustomerAddressRouter();
