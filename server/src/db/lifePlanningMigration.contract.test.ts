import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const migrationUrl = new URL('../../migrations/009_life_planning.sql', import.meta.url)

const normalize = (value: string) => value
  .replace(/`/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase()

function tableBody(sql: string, tableName: string) {
  const match = sql.match(new RegExp(`CREATE\\s+TABLE\\s+${tableName}\\s*\\(([\\s\\S]*?)\\)\\s*ENGINE\\s*=`, 'i'))
  expect(match, `migration 009 must create ${tableName}`).not.toBeNull()
  return normalize(match?.[1] ?? '')
}

function expectColumn(body: string, column: string, definition: RegExp) {
  expect(body, `${column} must satisfy ${definition}`).toMatch(definition)
}

function triggerBody(sql: string, triggerName: string) {
  const normalizedSql = normalize(sql)
  const match = normalizedSql.match(new RegExp(`create trigger ${triggerName} ([\\s\\S]*?)(?=create trigger |$)`))
  expect(match, `migration 009 must create ${triggerName}`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('ADR-023 planning migration contract', () => {
  it('persists bounded owner-scoped medicine occurrences with stable original identities and mutable current schedules', async () => {
    const sql = await readFile(migrationUrl, 'utf8')
    const body = tableBody(sql, 'life_medicine_recurrence_occurrences')

    expectColumn(body, 'id', /(?:^|, )id char\(36\) primary key(?:,|$)/)
    expectColumn(body, 'user_id', /(?:^|, )user_id char\(36\) not null(?:,|$)/)
    expectColumn(body, 'rule_id', /(?:^|, )rule_id char\(36\) not null(?:,|$)/)
    expectColumn(body, 'title', /(?:^|, )title varchar\(240\) not null(?:,|$)/)
    expectColumn(body, 'source_item_id', /(?:^|, )source_item_id char\(36\) not null(?:,|$)/)
    expectColumn(body, 'quantity', /(?:^|, )quantity decimal\(18,6\) not null(?:,|$)/)
    expectColumn(body, 'unit', /(?:^|, )unit varchar\(80\) not null(?:,|$)/)
    expectColumn(body, 'original_date', /(?:^|, )original_date date not null(?:,|$)/)
    expectColumn(body, 'original_time', /(?:^|, )original_time time(?:\(0\))? not null(?:,|$)/)
    expectColumn(body, 'scheduled_date', /(?:^|, )scheduled_date date not null(?:,|$)/)
    expectColumn(body, 'scheduled_time', /(?:^|, )scheduled_time time(?:\(0\))? not null(?:,|$)/)
    expectColumn(body, 'status', /(?:^|, )status enum\('planned',\s*'completed',\s*'skipped',\s*'cancelled'\) not null(?:,|$)/)
    expectColumn(body, 'completion_id', /(?:^|, )completion_id char\(36\) null(?:,|$)/)
    expectColumn(body, 'entity_version', /(?:^|, )entity_version bigint unsigned not null default 1(?:,|$)/)
    expectColumn(body, 'created_at', /(?:^|, )created_at datetime\(3\) not null(?:,|$)/)
    expectColumn(body, 'updated_at', /(?:^|, )updated_at datetime\(3\) not null(?:,|$)/)

    expect(body).toMatch(/unique key uq_life_medicine_occurrence_identity \(user_id, rule_id, original_date, original_time\)/)
    expect(body).toMatch(/unique key uq_life_medicine_occurrences_user_id \(user_id, id\)/)
    expect(body).toMatch(/key idx_life_medicine_occurrences_owner_schedule \(user_id, scheduled_date, scheduled_time, status\)/)
    expect(body).toMatch(/key idx_life_medicine_occurrences_rule_state \(user_id, rule_id, status, scheduled_date\)/)
    expect(body).toMatch(/key idx_life_medicine_occurrences_source \(user_id, source_item_id, status\)/)
    expect(body).toMatch(/constraint chk_life_medicine_occurrence_quantity check \(quantity > 0\)/)
    expect(body).toMatch(/constraint chk_life_medicine_occurrence_version check \(entity_version >= 1 and updated_at >= created_at\)/)
    expect(body).toMatch(/constraint chk_life_medicine_occurrence_completion check \(\(status = 'completed' and completion_id is not null\) or \(status <> 'completed' and completion_id is null\)\)/)
    expect(body).toMatch(/constraint fk_life_medicine_occurrences_user foreign key \(user_id\) references users\(id\) on delete cascade/)
    expect(body).toMatch(/constraint fk_life_medicine_occurrences_rule foreign key \(user_id, rule_id\) references life_medicine_recurrence_rules\(user_id, id\) on delete restrict/)
    expect(body).toMatch(/constraint fk_life_medicine_occurrences_source foreign key \(user_id, source_item_id\) references life_items\(user_id, id\) on delete restrict/)

    const normalizedSql = normalize(sql)
    expect(normalizedSql).toMatch(/alter table life_medicine_recurrence_occurrences add constraint fk_life_medicine_occurrences_completion foreign key \(user_id, completion_id, id\) references life_completion_snapshots\(user_id, id, medicine_occurrence_id\) on delete restrict/)
  })

  it('stores exactly one nullable completion branch and freezes its discriminated source identity', async () => {
    const sql = await readFile(migrationUrl, 'utf8')
    const body = tableBody(sql, 'life_completion_snapshots')

    expectColumn(body, 'day_plan_id', /(?:^|, )day_plan_id char\(36\) null(?:,|$)/)
    expectColumn(body, 'day_plan_item_id', /(?:^|, )day_plan_item_id char\(36\) null(?:,|$)/)
    expectColumn(body, 'medicine_occurrence_id', /(?:^|, )medicine_occurrence_id char\(36\) null(?:,|$)/)
    expectColumn(body, 'completion_source_json', /(?:^|, )completion_source_json json not null(?:,|$)/)
    expect(body).toMatch(/key idx_life_completion_snapshots_occurrence \(user_id, medicine_occurrence_id\)/)
    expect(body).toMatch(/constraint fk_life_completion_snapshots_occurrence foreign key \(user_id, medicine_occurrence_id\) references life_medicine_recurrence_occurrences\(user_id, id\) on delete restrict/)

    const sourceCheck = body.match(/constraint chk_life_completion_snapshot_source check \(([\s\S]*?)\)(?:,|$)/)?.[1] ?? ''
    expect(sourceCheck, 'completion source CHECK must exist').not.toBe('')
    expect(sourceCheck).toContain('day_plan_id is not null')
    expect(sourceCheck).toContain('day_plan_item_id is not null')
    expect(sourceCheck).toContain('medicine_occurrence_id is null')
    expect(sourceCheck).toContain('day_plan_id is null')
    expect(sourceCheck).toContain('day_plan_item_id is null')
    expect(sourceCheck).toContain('medicine_occurrence_id is not null')
    expect(sourceCheck).toContain('day-plan-item')
    expect(sourceCheck).toContain('medicine-occurrence')
    expect(sourceCheck).toContain("completion_source_json ->> '$.dayplanid' = day_plan_id")
    expect(sourceCheck).toContain("completion_source_json ->> '$.dayplanitemid' = day_plan_item_id")
    expect(sourceCheck).toContain("completion_source_json ->> '$.id' = medicine_occurrence_id")
    for (const field of ['ruleid', 'originaldate', 'originaltime', 'scheduleddate', 'scheduledtime']) {
      expect(sourceCheck).toContain(`json_type(completion_source_json -> '$.${field}') = 'string'`)
    }
    expect(body).toMatch(/unique key uq_life_completion_snapshots_occurrence_link \(user_id, id, medicine_occurrence_id\)/)
    const sourceValidationTrigger = triggerBody(sql, 'trg_life_completion_snapshot_source_validate')
    expect(sourceValidationTrigger).toContain('before insert on life_completion_snapshots')
    for (const field of ['ruleid', 'originaldate', 'originaltime', 'scheduleddate', 'scheduledtime']) {
      expect(sourceValidationTrigger).toContain(`'$.${field}'`)
    }
    for (const occurrenceFact of ['new.item_kind', 'new.source_json', 'new.actual_quantity', 'new.actual_unit', 'new.actual_servings']) {
      expect(sourceValidationTrigger).toContain(occurrenceFact)
    }
    expect(sourceValidationTrigger).toContain("signal sqlstate '45000'")
  })

  it('retains immutable snapshot, reversal and occurrence-history triggers', async () => {
    const sql = await readFile(migrationUrl, 'utf8')
    const normalizedSql = normalize(sql)
    const immutableTriggers = [
      ['trg_life_completion_snapshots_no_update', 'update', 'life_completion_snapshots'],
      ['trg_life_completion_snapshots_no_delete', 'delete', 'life_completion_snapshots'],
      ['trg_life_completion_inventory_no_update', 'update', 'life_completion_inventory_events'],
      ['trg_life_completion_inventory_no_delete', 'delete', 'life_completion_inventory_events'],
      ['trg_life_completion_prepared_no_update', 'update', 'life_completion_prepared_food_events'],
      ['trg_life_completion_prepared_no_delete', 'delete', 'life_completion_prepared_food_events'],
      ['trg_life_completion_reversals_no_update', 'update', 'life_completion_reversals'],
      ['trg_life_completion_reversals_no_delete', 'delete', 'life_completion_reversals'],
    ] as const

    for (const [name, operation, table] of immutableTriggers) {
      expect(normalizedSql).toContain(`create trigger ${name} before ${operation} on ${table}`)
      expect(normalizedSql).toContain("signal sqlstate '45000' set message_text = 'life_completion_snapshot_immutable'")
    }

    const identityTrigger = triggerBody(sql, 'trg_life_medicine_occurrence_identity_no_update')
    for (const immutableField of ['id', 'user_id', 'rule_id', 'original_date', 'original_time', 'created_at']) {
      expect(identityTrigger, `${immutableField} must be protected by the occurrence identity trigger`).toContain(`new.${immutableField}`)
      expect(identityTrigger).toContain(`old.${immutableField}`)
    }
    expect(identityTrigger).toContain("signal sqlstate '45000'")
    expect(normalizedSql).toContain('create trigger trg_life_medicine_occurrence_no_delete before delete on life_medicine_recurrence_occurrences')
    expect(normalizedSql).toContain("signal sqlstate '45000' set message_text = 'life_medicine_occurrence_history_immutable'")

    const occurrenceDiscipline = triggerBody(sql, 'trg_life_medicine_occurrence_identity_no_update')
    expect(occurrenceDiscipline).toContain('new.entity_version <> old.entity_version + 1')
    expect(occurrenceDiscipline).toContain('new.updated_at < old.updated_at')
    expect(occurrenceDiscipline).toContain("old.status in ('skipped', 'cancelled')")
    expect(occurrenceDiscipline).toContain("old.status = 'completed'")
    expect(occurrenceDiscipline).toContain('life_completion_reversals')
    for (const frozenField of ['title', 'source_item_id', 'quantity', 'unit', 'scheduled_date', 'scheduled_time']) {
      expect(occurrenceDiscipline).toContain(`new.${frozenField}`)
      expect(occurrenceDiscipline).toContain(`old.${frozenField}`)
    }

    const ruleBody = tableBody(sql, 'life_medicine_recurrence_rules')
    expect(ruleBody).toMatch(/constraint chk_life_medicine_recurrence_version check \(entity_version >= 1 and updated_at >= created_at\)/)
    const ruleDiscipline = triggerBody(sql, 'trg_life_medicine_recurrence_rule_no_update')
    for (const immutableField of ['id', 'user_id', 'created_at']) {
      expect(ruleDiscipline).toContain(`new.${immutableField}`)
      expect(ruleDiscipline).toContain(`old.${immutableField}`)
    }
    expect(ruleDiscipline).toContain('new.entity_version <> old.entity_version + 1')
    expect(ruleDiscipline).toContain('new.updated_at < old.updated_at')
    expect(ruleDiscipline).toContain('old.deleted_at is not null')
    expect(normalizedSql).toContain('create trigger trg_life_medicine_recurrence_rule_no_delete before delete on life_medicine_recurrence_rules')
  })
})
