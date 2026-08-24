import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migrationUrl = new URL('../../migrations/010_life_commerce.sql', import.meta.url)
const normalize = (value: string) => value.replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

describe('P1-T12 commerce migration contract', () => {
  it('stores indivisible actual costs as deterministic fixed-point facts while cash remains integer minor units', async () => {
    const sql = normalize(await readFile(migrationUrl, 'utf8'))
    expect(sql).toContain('alter table life_inventory_batches modify actual_unit_cost_minor decimal(30,9) unsigned null')
    expect(sql).toContain('alter table life_cooking_snapshots modify total_cost_minor decimal(30,9) not null')
    expect(sql).toContain('alter table life_prepared_food_stock modify cost_remaining_minor decimal(30,9) not null')
    expect(sql).toContain('alter table life_completion_snapshots modify cost_minor decimal(30,9) null')
    expect(sql).toContain('alter table life_completion_prepared_food_events modify cost_minor decimal(30,9) not null')
    expect(sql).toMatch(/create table life_purchases .* total_amount_minor bigint unsigned not null/)
    expect(sql).toMatch(/create table life_cash_expenditures .* amount_minor bigint not null/)
  })

  it('persists owner-scoped shopping, purchase, refund, budget and portability relations', async () => {
    const sql = normalize(await readFile(migrationUrl, 'utf8'))
    for (const table of [
      'life_shopping_suggestions', 'life_shopping_suggestion_reasons', 'life_shopping_items',
      'life_purchases', 'life_purchase_items', 'life_refunds', 'life_refund_items',
      'life_cash_expenditures', 'life_budgets', 'life_exports', 'life_imports', 'life_commerce_idempotency',
    ]) expect(sql).toContain(`create table ${table}`)
    expect(sql).toContain('constraint chk_life_cash_source check')
    expect(sql).toContain('restore_point_export_id char(36) null')
    expect(sql).toContain('checksum_sha256 char(64) not null')
    expect(sql).toContain('foreign key (user_id, restore_point_export_id) references life_exports(user_id, id) on delete restrict')
  })

  it('stores versioned inventory policies and separates manual from derived suggestion identity', async () => {
    const sql = normalize(await readFile(migrationUrl, 'utf8'))
    expect(sql).toMatch(/create table life_inventory_policies .*minimum_stock decimal\(30,12\) not null.*package_quantity decimal\(30,12\) not null.*unit_id varchar\(80\) not null.*unit varchar\(80\) not null.*entity_version bigint unsigned not null default 1/)
    expect(sql).toContain('unique key uq_life_inventory_policy_user_item (user_id, item_id)')
    expect(sql).toContain('constraint chk_life_inventory_policy_values check (minimum_stock >= 0 and package_quantity > 0 and entity_version >= 1 and updated_at >= created_at)')
    expect(sql).toContain("suggestion_origin enum('manual', 'derived') not null")
    expect(sql).toContain('suggested_quantity decimal(30,12) not null')
    expect(sql).toContain('through_date date null')
    expect(sql).toContain('unique key uq_life_shopping_suggestion_user_item_origin (user_id, item_id, suggestion_origin)')
    expect(sql).toContain("constraint chk_life_shopping_suggestion_origin check ((suggestion_origin = 'manual' and through_date is null) or (suggestion_origin = 'derived' and through_date is not null))")
    expect(sql).toContain('source_quantity decimal(30,12) not null')
    expect(sql).toContain('source_unit varchar(80) not null')
    expect(sql).toContain('conversion_factor decimal(30,12) not null')
    expect(sql).toContain('create trigger trg_life_inventory_policy_version_before_update')
  })

  it('keeps immutable business evidence protected outside the narrow restore session', async () => {
    const sql = normalize(await readFile(migrationUrl, 'utf8'))
    for (const trigger of [
      'trg_life_inventory_transactions_no_delete', 'trg_life_recipe_versions_no_delete',
      'trg_life_completion_snapshots_no_delete', 'trg_life_completion_reversals_no_delete',
      'trg_life_medicine_occurrence_no_delete',
    ]) {
      expect(sql).toContain(`create trigger ${trigger}`)
    }
    expect(sql).toContain('coalesce(@lifeops_restore_mode, 0) <> 1')
    for (const table of [
      'life_purchases', 'life_purchase_items', 'life_refunds', 'life_refund_items',
      'life_cash_expenditures', 'life_exports',
    ]) {
      expect(sql).toContain(`create trigger trg_${table}_no_update`)
      expect(sql).toContain(`create trigger trg_${table}_no_delete`)
    }
  })
})
