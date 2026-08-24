import type {
  CatalogBatchInput,
  CatalogDeleteImpact,
  CatalogFilters,
  CatalogItem,
  CreateCatalogItemInput,
  CreateTaxonomyInput,
  CreateUnitInput,
  LifeUnit,
  TaxonomyEntity,
  TaxonomyKind,
  UpdateCatalogItemInput,
  UpdateTaxonomyInput,
  UpdateUnitInput,
} from '../domain/life/catalog.js'

export interface LifeCatalogStore {
  listCatalogItems(userId: string, filters?: CatalogFilters): Promise<CatalogItem[]>
  getCatalogItem(userId: string, id: string): Promise<CatalogItem | undefined>
  createCatalogItem(userId: string, input: CreateCatalogItemInput, idempotencyKey: string): Promise<CatalogItem>
  updateCatalogItem(userId: string, id: string, input: UpdateCatalogItemInput): Promise<CatalogItem | undefined>
  batchUpdateCatalogItems(userId: string, input: CatalogBatchInput): Promise<CatalogItem[]>
  previewCatalogItemDelete(userId: string, id: string): Promise<CatalogDeleteImpact | undefined>
  deleteCatalogItem(userId: string, id: string, version: number): Promise<boolean>
  listDeletedCatalogItems(userId: string): Promise<CatalogItem[]>
  restoreCatalogItem(userId: string, id: string, version: number): Promise<CatalogItem | undefined>

  listTaxonomy(userId: string, kind: TaxonomyKind, includeDeleted?: boolean): Promise<TaxonomyEntity[]>
  createTaxonomy(userId: string, kind: TaxonomyKind, input: CreateTaxonomyInput): Promise<TaxonomyEntity>
  updateTaxonomy(userId: string, kind: TaxonomyKind, id: string, input: UpdateTaxonomyInput): Promise<TaxonomyEntity | undefined>
  deleteTaxonomy(userId: string, kind: TaxonomyKind, id: string, version: number): Promise<boolean>
  restoreTaxonomy(userId: string, kind: TaxonomyKind, id: string, version: number): Promise<TaxonomyEntity | undefined>

  listUnits(userId: string, includeDeleted?: boolean): Promise<LifeUnit[]>
  createUnit(userId: string, input: CreateUnitInput): Promise<LifeUnit>
  updateUnit(userId: string, id: string, input: UpdateUnitInput): Promise<LifeUnit | undefined>
  deleteUnit(userId: string, id: string, version: number): Promise<boolean>
  restoreUnit(userId: string, id: string, version: number): Promise<LifeUnit | undefined>
}
