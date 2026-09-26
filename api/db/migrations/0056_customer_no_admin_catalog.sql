-- ============================================================================
-- Migration 0056: customers lose products.read (admin catalog access)
-- ============================================================================
--
-- products.read guards only the ADMIN product endpoints (GET
-- /api/v1/admin/products and /admin/products/:id), which expose drafts,
-- archived products, SKUs and stock. The public storefront catalog needs no
-- permission at all, so CUSTOMER never needed it — holding it let any signed
-- in shopper read the back-office listing. src/lib/rbac.ts is the enforced
-- source of truth; this keeps the reference copy in sync.

DELETE FROM role_permissions WHERE role = 'CUSTOMER' AND permission_code = 'products.read';

UPDATE permissions SET description = 'View the admin product catalog (drafts, archived, stock)' WHERE code = 'products.read';
