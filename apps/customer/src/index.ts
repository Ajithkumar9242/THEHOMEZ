/**
 * @thehomez/customer-app package exports
 */

export { App, type AppProps } from './App.js';
export { AuthProvider, useAuth } from './context/AuthContext.js';
export { AuthClient, AuthApiError } from './api/auth-client.js';
export { StorefrontProvider, useStorefront } from './context/StorefrontContext.js';
export { StorefrontClient, StorefrontApiError } from './api/storefront-client.js';
export { AddressClient, AddressApiError } from './api/address-client.js';
export { CartClient, CartApiError } from './api/cart-client.js';
export { CheckoutClient, CheckoutApiError } from './api/checkout-client.js';
export { CartProvider, useCart, useOptionalCart } from './context/CartContext.js';
export { ProtectedRoute, type ProtectedRouteProps } from './routing/ProtectedRoute.js';
export {
  sanitizeRedirectPath,
  getRedirectTargetFromSearch,
  buildLoginRedirectUrl,
  ADDRESSES_ROUTE_PATH,
  CART_ROUTE_PATH,
  CHECKOUT_PREPARE_ROUTE_PATH,
} from './routing/redirect-utils.js';
export { Header } from './components/layout/Header.js';
export { Footer } from './components/layout/Footer.js';
export { LocationModal } from './components/location/LocationModal.js';
export {
  CustomerAuthModal,
  CustomerAuthFlow,
  CustomerLoginView,
} from './components/auth/index.js';
export {
  AccountNavigation,
  AddressCard,
  AddressFormModal,
  AddressDetailsModal,
  DeleteAddressDialog,
} from './components/addresses/index.js';
export { CartItemRow, CartSummaryCard, ClearCartDialog } from './components/cart/index.js';
export { ProductCard } from './components/catalog/ProductCard.js';
export { AvailabilityBadge } from './components/catalog/AvailabilityBadge.js';
export { CategoryRail } from './components/catalog/CategoryRail.js';
export { FilterSidebar } from './components/catalog/FilterSidebar.js';
export { SortSelector } from './components/catalog/SortSelector.js';
export { VariantSelector } from './components/product-detail/VariantSelector.js';
export { QuantityStepper } from './components/product-detail/QuantityStepper.js';
export { VolumeTierTable } from './components/product-detail/VolumeTierTable.js';
export { HomeView } from './views/HomeView.js';
export { ProductListingView } from './views/ProductListingView.js';
export { ProductDetailView } from './views/ProductDetailView.js';
export { CustomerAccountView } from './views/CustomerAccountView.js';
export { CustomerAddressesView } from './views/CustomerAddressesView.js';
export { CartView } from './views/CartView.js';
export { CheckoutPreparationView } from './views/CheckoutPreparationView.js';
