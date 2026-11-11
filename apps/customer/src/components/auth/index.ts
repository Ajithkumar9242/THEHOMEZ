export { CustomerAuthModal, type CustomerAuthModalProps } from './CustomerAuthModal.js';
export { CustomerAuthFlow, type CustomerAuthFlowProps } from './CustomerAuthFlow.js';
export { CustomerLoginView, type CustomerLoginViewProps } from './CustomerLoginView.js';
export { PhoneLoginStep, type PhoneLoginStepProps } from './PhoneLoginStep.js';
export { OtpVerificationStep, type OtpVerificationStepProps } from './OtpVerificationStep.js';
export { OtpInput, type OtpInputProps } from './OtpInput.js';
export { TheHomezBrandMark, type TheHomezBrandMarkProps } from './TheHomezBrandMark.js';
export {
  CustomerAuthBridgeProvider,
  useCustomerAuthBridge,
  useOptionalAuthContext,
  type CustomerAuthBridgeProviderProps,
} from './AuthUiContext.js';
export {
  DEFAULT_COUNTRY_CODE,
  DEFAULT_OTP_RESEND_COOLDOWN_SECONDS,
  DEFAULT_OTP_TTL_SECONDS,
  OTP_LENGTH,
  SUPPORTED_COUNTRY_CODES,
  type AuthErrorCategory,
  type AuthFlowStatus,
  type AuthStep,
  type CountryCodeOption,
  type ICustomerAuthContextContract,
  type NormalizedAuthError,
} from './auth-ui.types.js';
export {
  buildE164Phone,
  formatCountdownSeconds,
  formatDisplayPhone,
  getCountryCodeOption,
  normalizeAuthError,
  sanitizePhoneInput,
  validateLocalPhone,
} from './auth-utils.js';
