CREATE TABLE "ifood_catalog_links" (
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "local_id" UUID NOT NULL,
    CONSTRAINT "ifood_catalog_links_pkey" PRIMARY KEY ("tenant_id", "kind", "external_id"),
    CONSTRAINT "ifood_catalog_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ifood_catalog_links_tenant_id_kind_local_id_key"
ON "ifood_catalog_links"("tenant_id", "kind", "local_id");
