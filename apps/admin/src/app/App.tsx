import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../layouts/AdminLayout.js';
import { AuthProvider, SignInPage } from '../providers/AuthProvider.js';
import { ProtectedRoute } from '../routes/ProtectedRoute.js';
import { PermissionCode } from '@thehomez/shared-types';
import { Outlet } from 'react-router-dom';
import { CategoryBrowserPage } from '../features/categories/pages/CategoryBrowserPage.js';
import { CategoryDetailPage } from '../features/categories/pages/CategoryDetailPage.js';
import { ProductListPage } from '../features/catalogue/pages/ProductListPage.js';
import { ProductDetailPage } from '../features/catalogue/pages/ProductDetailPage.js';
import { VariantListPage } from '../features/catalogue/pages/VariantListPage.js';
import { VariantDetailPage } from '../features/catalogue/pages/VariantDetailPage.js';
import { ServiceAreaListPage } from '../features/service-areas/pages/ServiceAreaListPage.js';
import { ServiceAreaDetailPage } from '../features/service-areas/pages/ServiceAreaDetailPage.js';
import { UnitListPage } from '../features/units/pages/UnitListPage.js';
import { UnitDetailPage } from '../features/units/pages/UnitDetailPage.js';
import {
  ProductPricingDetailPage,
  VariantPricingDetailPage,
} from '../features/catalogue/pages/PricingDetailPage.js';
import { CustomerDirectoryPage } from '../features/customers/pages/CustomerDirectoryPage.js';
import { CustomerDetailPage } from '../features/customers/pages/CustomerDetailPage.js';
import { PartnerDirectoryPage } from '../features/partners/pages/PartnerDirectoryPage.js';
import { PartnerDetailPage } from '../features/partners/pages/PartnerDetailPage.js';
import { PartnerApplicationDirectoryPage } from '../features/partner-applications/pages/PartnerApplicationDirectoryPage.js';
import { PartnerApplicationDetailPage } from '../features/partner-applications/pages/PartnerApplicationDetailPage.js';
import { DashboardOverviewPage } from '../features/dashboard/pages/DashboardOverviewPage.js';

function CategoryLayout() {
  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}

function ShellRoutes() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route element={<ProtectedRoute />}>
        <Route
          path="/"
          element={
            <AdminLayout>
              <DashboardOverviewPage />
            </AdminLayout>
          }
        />
      </Route>
      <Route element={<ProtectedRoute permission={PermissionCode.CATALOG_READ} />}>
        <Route element={<CategoryLayout />}>
          <Route path="/catalogue/categories" element={<CategoryBrowserPage />} />
          <Route path="/catalogue/categories/:slug" element={<CategoryDetailPage />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute permission={PermissionCode.PRICING_READ} />}>
        <Route element={<CategoryLayout />}>
          <Route
            path="/catalogue/products/:productId/pricing"
            element={<ProductPricingDetailPage />}
          />
          <Route
            path="/catalogue/products/:productId/variants/:variantId/pricing"
            element={<VariantPricingDetailPage />}
          />
        </Route>
      </Route>
      <Route element={<ProtectedRoute permission={PermissionCode.SERVICE_AREA_READ} />}>
        <Route element={<CategoryLayout />}>
          <Route path="/service-areas" element={<ServiceAreaListPage />} />
          <Route path="/service-areas/:serviceAreaId" element={<ServiceAreaDetailPage />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute permission={PermissionCode.CUSTOMER_READ} />}>
        <Route element={<CategoryLayout />}>
          <Route path="/customers" element={<CustomerDirectoryPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
        </Route>
      </Route>
      <Route element={<ProtectedRoute permission={PermissionCode.PARTNER_READ} />}>
        <Route element={<CategoryLayout />}>
          <Route path="/partners" element={<PartnerDirectoryPage />} />
          <Route path="/partners/:partnerId" element={<PartnerDetailPage />} />
          <Route path="/partner-applications" element={<PartnerApplicationDirectoryPage />} />
          <Route
            path="/partner-applications/:applicationId"
            element={<PartnerApplicationDetailPage />}
          />
        </Route>
      </Route>
      <Route element={<ProtectedRoute permission={PermissionCode.CATALOG_READ} />}>
        <Route element={<CategoryLayout />}>
          <Route path="/catalogue/products" element={<ProductListPage />} />
          <Route path="/catalogue/products/:productId" element={<ProductDetailPage />} />
          <Route path="/catalogue/products/:productId/variants" element={<VariantListPage />} />
          <Route
            path="/catalogue/products/:productId/variants/:variantId"
            element={<VariantDetailPage />}
          />
        </Route>
      </Route>
      <Route element={<ProtectedRoute permission={PermissionCode.CATALOG_READ} />}>
        <Route element={<CategoryLayout />}>
          <Route path="/catalogue/units" element={<UnitListPage />} />
          <Route path="/catalogue/units/:code" element={<UnitDetailPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ShellRoutes />
    </AuthProvider>
  );
}
