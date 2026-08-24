import { createHash, randomUUID } from 'node:crypto'
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { CatalogItem, LifeUnit, TaxonomyEntity, TaxonomyKind } from '../../domain/life/catalog.js'
import type { InventoryBalance } from '../../domain/life/inventory.js'
import {
  LifeRecipesDomainError,
  buildIngredientRecipeRelations,
  calculateRecipe,
  diffRecipeVersions,
  recipeVersionChanged,
  resolveCookingCompletion,
  resolveCookingNotePromotion,
  selectRecipeVersion,
  type CookingCompletionResult,
  type CookingSession,
  type CreateRecipeInput,
  type PreparedFoodStock,
  type Recipe,
  type RecipeVersion,
  type RecipeVersionInput,
  type UpdateCookingSessionInput,
  type UpdateRecipeInput,
} from '../../domain/life/recipes.js'
import type { LifeRecipeStore } from '../lifeRecipeStore.js'

type SqlRow = RowDataPacket & Record<string, unknown>
type Executor = Pool | PoolConnection
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => `${JSON.stringify(name)}:${stable(item)}`).join(',')}}` : JSON.stringify(value)
const requestHash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex').toUpperCase()
const sqlDate = (value: string) => new Date(value).toISOString().slice(0, 23).replace('T', ' ')
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : `${String(value).replace(' ', 'T')}Z`
const parse = <T>(value: unknown): T => typeof value === 'string' ? JSON.parse(value) as T : structuredClone(value) as T
const round = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000
async function rows<T>(executor: Executor, sql: string, values: unknown[] = []): Promise<T[]> { const [result] = await executor.execute(sql, values as never[]); return result as unknown as T[] }

export class MySqlLifeRecipeStore implements LifeRecipeStore {
  private createId = () => this.options.createId?.() ?? randomUUID()
  private now = () => this.options.now?.() ?? new Date().toISOString()

  constructor(private readonly pool: Pool, private readonly options: {
    createId?: () => string
    now?: () => string
    getCatalogItem(userId: string, itemId: string): Promise<CatalogItem | undefined>
    listCatalogItems(userId: string): Promise<CatalogItem[]>
    listCatalogItemsFrom(executor: Executor, userId: string): Promise<CatalogItem[]>
    listTaxonomy(userId: string, kind: TaxonomyKind): Promise<TaxonomyEntity[]>
    listUnits(userId: string): Promise<LifeUnit[]>
    listUnitsFrom(executor: Executor, userId: string): Promise<LifeUnit[]>
    getMediaAsset(userId: string, id: string): Promise<unknown | undefined>
    listInventoryBalances(userId: string): Promise<InventoryBalance[]>
    listInventoryBalancesFrom(executor: Executor, userId: string): Promise<InventoryBalance[]>
    consumeRecipeIngredients(connection: PoolConnection, userId: string, inputs: Array<{ itemId: string; quantity: number; unit: string }>, occurredAt: string, sessionId: string): Promise<unknown>
  }) {}

  async listRecipes(userId: string) {
    const recipeRows = await rows<SqlRow>(this.pool, 'SELECT * FROM life_recipes WHERE user_id = ? AND deleted_at IS NULL ORDER BY name, id', [userId])
    return Promise.all(recipeRows.map((row) => this.mapRecipe(this.pool, userId, row)))
  }
  async listDeletedRecipes(userId: string) {
    const recipeRows = await rows<SqlRow>(this.pool, 'SELECT * FROM life_recipes WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, name, id', [userId])
    return Promise.all(recipeRows.map((row) => this.mapRecipe(this.pool, userId, row)))
  }
  async getRecipe(userId: string, id: string) {
    const found = await rows<SqlRow>(this.pool, 'SELECT * FROM life_recipes WHERE user_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1', [userId, id])
    return found[0] ? this.mapRecipe(this.pool, userId, found[0]) : undefined
  }
  async createRecipe(userId: string, input: CreateRecipeInput, key: string) {
    return this.idempotently<Recipe>(userId, 'create-recipe', key, input, async (connection) => {
      await this.validateInput(userId, input)
      const timestamp = this.now(); const recipeId = this.createId()
      await connection.execute(`INSERT INTO life_recipes (id,user_id,name,description,cover_media_id,prep_minutes,cook_minutes,difficulty,category_id,tag_ids,storage_notes,current_version_id,entity_version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,1,?,?)`, [recipeId,userId,input.name.trim(),input.description?.trim()??'',input.coverMediaId??null,input.prepMinutes??0,input.cookMinutes??0,input.difficulty??'easy',input.categoryId??null,JSON.stringify(input.tagIds??[]),input.storageNotes?.trim()??'',sqlDate(timestamp),sqlDate(timestamp)])
      const version = await this.insertVersion(connection,userId,recipeId,1,input,timestamp)
      await connection.execute('UPDATE life_recipes SET current_version_id = ? WHERE user_id = ? AND id = ?', [version.id,userId,recipeId])
      return this.mapRecipe(connection,userId,(await rows<SqlRow>(connection,'SELECT * FROM life_recipes WHERE user_id=? AND id=?',[userId,recipeId]))[0])
    })
  }
  async previewRecipeImpact(userId: string, id: string, input: UpdateRecipeInput) {
    const recipe = await this.getRecipe(userId,id); if(!recipe) return undefined
    this.assertVersion(recipe,input.entityVersion); await this.validateInput(userId,input)
    const proposed=this.buildVersion(id,recipe.currentVersion.number+1,input,this.now(),recipe.currentVersion.promotedNote);const createsVersion=recipeVersionChanged(recipe.currentVersion,proposed)
    return {writesApplied:false as const,createsVersion,nextVersionNumber:createsVersion?proposed.number:recipe.currentVersion.number,futurePlansAffected:0,diff:diffRecipeVersions(recipe.currentVersion,proposed),calculation:await this.calculation(userId,proposed,this.now().slice(0,10))}
  }
  async updateRecipe(userId:string,id:string,input:UpdateRecipeInput){
    await this.validateInput(userId,input); const connection=await this.pool.getConnection()
    try{await connection.beginTransaction(); const found=await rows<SqlRow>(connection,'SELECT * FROM life_recipes WHERE user_id=? AND id=? AND deleted_at IS NULL FOR UPDATE',[userId,id]); if(!found[0]){await connection.rollback();return undefined}
      if(Number(found[0].entity_version)!==input.entityVersion) throw new LifeRecipesDomainError('VERSION_CONFLICT','The recipe changed since it was loaded.',409)
      const current=await this.loadVersion(connection,userId,String(found[0].current_version_id)); const timestamp=this.now(); const proposed=this.buildVersion(id,current.number+1,input,timestamp,current.promotedNote);const createsVersion=recipeVersionChanged(current,proposed);const next=createsVersion?proposed:current;if(createsVersion)await this.insertExistingVersion(connection,userId,next)
      await connection.execute(`UPDATE life_recipes SET name=?,description=?,cover_media_id=?,prep_minutes=?,cook_minutes=?,difficulty=?,category_id=?,tag_ids=?,storage_notes=?,current_version_id=?,entity_version=entity_version+1,updated_at=? WHERE user_id=? AND id=?`,[input.name.trim(),input.description?.trim()??'',input.coverMediaId??null,input.prepMinutes??0,input.cookMinutes??0,input.difficulty??'easy',input.categoryId??null,JSON.stringify(input.tagIds??[]),input.storageNotes?.trim()??'',next.id,sqlDate(timestamp),userId,id])
      const result=await this.mapRecipe(connection,userId,(await rows<SqlRow>(connection,'SELECT * FROM life_recipes WHERE user_id=? AND id=?',[userId,id]))[0]); await connection.commit(); return result
    }catch(error){await connection.rollback();throw error}finally{connection.release()}
  }
  async deleteRecipe(userId:string,id:string,entityVersion:number){
    const connection=await this.pool.getConnection()
    try{await connection.beginTransaction();const found=await rows<SqlRow>(connection,'SELECT entity_version FROM life_recipes WHERE user_id=? AND id=? AND deleted_at IS NULL FOR UPDATE',[userId,id]);if(!found[0]){await connection.rollback();return false}
      if(Number(found[0].entity_version)!==entityVersion)throw new LifeRecipesDomainError('VERSION_CONFLICT','The recipe changed since it was loaded.',409)
      const timestamp=this.now();await connection.execute('UPDATE life_recipes SET deleted_at=?,updated_at=?,entity_version=entity_version+1 WHERE user_id=? AND id=?',[sqlDate(timestamp),sqlDate(timestamp),userId,id]);await connection.commit();return true
    }catch(error){await connection.rollback();throw error}finally{connection.release()}
  }
  async restoreRecipe(userId:string,id:string,entityVersion:number){
    const connection=await this.pool.getConnection()
    try{await connection.beginTransaction();const found=await rows<SqlRow>(connection,'SELECT * FROM life_recipes WHERE user_id=? AND id=? AND deleted_at IS NOT NULL FOR UPDATE',[userId,id]);if(!found[0]){await connection.rollback();return undefined}
      if(Number(found[0].entity_version)!==entityVersion)throw new LifeRecipesDomainError('VERSION_CONFLICT','The recipe changed since it was loaded.',409)
      const timestamp=this.now();await connection.execute('UPDATE life_recipes SET deleted_at=NULL,updated_at=?,entity_version=entity_version+1 WHERE user_id=? AND id=?',[sqlDate(timestamp),userId,id]);const restored=(await rows<SqlRow>(connection,'SELECT * FROM life_recipes WHERE user_id=? AND id=?',[userId,id]))[0];const result=await this.mapRecipe(connection,userId,restored);await connection.commit();return result
    }catch(error){await connection.rollback();throw error}finally{connection.release()}
  }
  async listRecipeVersions(userId:string,recipeId:string){ if(!(await this.getRecipe(userId,recipeId))) return undefined; const found=await rows<SqlRow>(this.pool,'SELECT * FROM life_recipe_versions WHERE user_id=? AND recipe_id=? ORDER BY version_number',[userId,recipeId]); return Promise.all(found.map((row)=>this.mapVersion(this.pool,userId,row))) }
  async calculateStoredRecipe(userId:string,recipeId:string,input:{mode:'latest'|'pinned';versionId?:string;asOf:string}){return this.calculateStoredRecipeFrom(this.pool,userId,recipeId,input)}
  async calculateStoredRecipeFrom(executor:Executor,userId:string,recipeId:string,input:{mode:'latest'|'pinned';versionId?:string;asOf:string}){const recipe=(await rows<SqlRow>(executor,'SELECT id FROM life_recipes WHERE user_id=? AND id=? AND deleted_at IS NULL LIMIT 1',[userId,recipeId]))[0];if(!recipe)return undefined;const found=await rows<SqlRow>(executor,'SELECT * FROM life_recipe_versions WHERE user_id=? AND recipe_id=? ORDER BY version_number',[userId,recipeId]);const versions=await Promise.all(found.map((row)=>this.mapVersion(executor,userId,row)));const selected=selectRecipeVersion(versions,input.mode==='latest'?{mode:'latest'}:{mode:'pinned',versionId:input.versionId??''});return{...(await this.calculationFrom(executor,userId,selected,input.asOf)),recipeVersionId:selected.id,recipeVersionNumber:selected.number}}
  async listRecipeRelations(userId:string,itemId?:string){const recipes=await this.listRecipes(userId);return buildIngredientRecipeRelations(recipes.map((recipe)=>({id:recipe.id,name:recipe.name,version:recipe.currentVersion})),itemId)}
  async createCookingSession(userId:string,input:{recipeId:string;recipeVersionId?:string;plannedServings:number;note?:string},key:string){
    return this.idempotently<CookingSession>(userId,'create-cooking-session',key,input,async(connection)=>{if(!Number.isFinite(input.plannedServings)||input.plannedServings<=0)throw new LifeRecipesDomainError('INVALID_INPUT','plannedServings must be positive.');const recipeRow=(await rows<SqlRow>(connection,'SELECT * FROM life_recipes WHERE user_id=? AND id=? AND deleted_at IS NULL',[userId,input.recipeId]))[0];if(!recipeRow)throw new LifeRecipesDomainError('NOT_FOUND','The recipe does not exist.',404);const recipe=await this.mapRecipe(connection,userId,recipeRow);const versionRows=await rows<SqlRow>(connection,'SELECT * FROM life_recipe_versions WHERE user_id=? AND recipe_id=? ORDER BY version_number',[userId,recipe.id]);const versions=await Promise.all(versionRows.map((row)=>this.mapVersion(connection,userId,row)));const version=selectRecipeVersion(versions,input.recipeVersionId?{mode:'pinned',versionId:input.recipeVersionId}:{mode:'latest'});const timestamp=this.now(),id=this.createId();const progress={currentStepIndex:0,completedStepIds:[],actualIngredients:[],timers:[]};await connection.execute(`INSERT INTO life_cooking_sessions (id,user_id,recipe_id,recipe_version_id,planned_servings,note,entity_version,progress_json,status,created_at,completed_at) VALUES (?,?,?,?,?,?,1,?,'active',?,NULL)`,[id,userId,recipe.id,version.id,input.plannedServings,input.note?.trim()??'',JSON.stringify(progress),sqlDate(timestamp)]);return{id,recipeId:recipe.id,recipeVersionId:version.id,plannedServings:input.plannedServings,note:input.note?.trim()??'',entityVersion:1,progress,status:'active',createdAt:timestamp,completedAt:null}})
  }
  async getCookingSession(userId:string,id:string){return this.session(this.pool,userId,id)}
  async updateCookingSession(userId:string,id:string,input:UpdateCookingSessionInput){const connection=await this.pool.getConnection();try{await connection.beginTransaction();const session=await this.session(connection,userId,id,true);if(!session){await connection.rollback();return undefined}if(session.status!=='active')throw new LifeRecipesDomainError('COOKING_ALREADY_COMPLETED','This cooking session is already complete.',409);if(session.entityVersion!==input.entityVersion)throw new LifeRecipesDomainError('VERSION_CONFLICT','The cooking session changed since it was loaded.',409);const progress=await this.validateCookingProgress(userId,session,input);await connection.execute('UPDATE life_cooking_sessions SET progress_json=?,entity_version=entity_version+1 WHERE user_id=? AND id=?',[JSON.stringify(progress),userId,id]);await connection.commit();return{...session,entityVersion:session.entityVersion+1,progress}}catch(error){await connection.rollback();throw error}finally{connection.release()}}
  async promoteCookingNote(userId:string,sessionId:string,expectedRecipeVersion:number,key:string){const exists=await this.session(this.pool,userId,sessionId);if(!exists)return undefined;return this.idempotently<RecipeVersion>(userId,`promote-note:${sessionId}`,key,{expectedRecipeVersion},async(connection)=>{const session=await this.session(connection,userId,sessionId,true);if(!session)throw new LifeRecipesDomainError('NOT_FOUND','The cooking session does not exist.',404);const recipeRows=await rows<SqlRow>(connection,'SELECT * FROM life_recipes WHERE user_id=? AND id=? AND deleted_at IS NULL FOR UPDATE',[userId,session.recipeId]);if(!recipeRows[0])throw new LifeRecipesDomainError('NOT_FOUND','The recipe does not exist.',404);const recipe=await this.mapRecipe(connection,userId,recipeRows[0]);this.assertVersion(recipe,expectedRecipeVersion);const resolved=resolveCookingNotePromotion({version:recipe.currentVersion,note:session.note,promote:true,nextVersionId:this.createId(),createdAt:this.now(),createId:this.createId}).promotedVersion!;await this.insertExistingVersion(connection,userId,resolved);await connection.execute('UPDATE life_recipes SET current_version_id=?,entity_version=entity_version+1,updated_at=? WHERE user_id=? AND id=?',[resolved.id,sqlDate(resolved.createdAt),userId,recipe.id]);return resolved})}
  async completeCookingSession(userId:string,sessionId:string,input:{madeServings:number;eatenServings:number;completedAt:string},key:string){const existing=await this.session(this.pool,userId,sessionId);if(!existing)return undefined
    return this.idempotently<CookingCompletionResult>(userId,`complete-cooking:${sessionId}`,key,input,async(connection)=>{const session=await this.session(connection,userId,sessionId,true);if(!session)throw new LifeRecipesDomainError('NOT_FOUND','The cooking session does not exist.',404);if(session.status==='completed')throw new LifeRecipesDomainError('COOKING_ALREADY_COMPLETED','This cooking session is already complete.',409);const version=await this.loadVersion(connection,userId,session.recipeVersionId);const completionVersion=this.resolveActualVersion(version,session,input.madeServings);const calculation=await this.calculation(userId,completionVersion,input.completedAt.slice(0,10),session.progress.actualIngredients.length?undefined:input.madeServings);const outcome=resolveCookingCompletion({calculation,madeServings:input.madeServings,eatenServings:input.eatenServings});await this.options.consumeRecipeIngredients(connection,userId,outcome.ingredientConsumption,input.completedAt,sessionId)
      const snapshotId=this.createId(),timestamp=this.now(),totalCost=calculation.totalCostMinor!,totalNutrition=calculation.totalNutrition!;const snapshotIngredients=calculation.ingredients.map((ingredient)=>({...ingredient,replacesItemId:session.progress.actualIngredients.find((actual)=>actual.itemId===ingredient.itemId)?.replacesItemId??null}));const snapshot={id:snapshotId,cookingSessionId:sessionId,recipeId:session.recipeId,recipeVersionId:session.recipeVersionId,madeServings:input.madeServings,eatenServings:input.eatenServings,ingredients:snapshotIngredients,totalCostMinor:totalCost,totalNutrition,intakeNutrition:outcome.intakeNutrition,cookingOilGrams:calculation.cookingOilGrams!,intakeCookingOilGrams:outcome.intakeCookingOilGrams,completedAt:new Date(input.completedAt).toISOString()}
      await connection.execute(`INSERT INTO life_cooking_snapshots (id,user_id,cooking_session_id,recipe_id,recipe_version_id,made_servings,eaten_servings,ingredients_snapshot,total_cost_minor,total_nutrition,intake_nutrition,cooking_oil_grams,intake_cooking_oil_grams,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[snapshotId,userId,sessionId,session.recipeId,session.recipeVersionId,input.madeServings,input.eatenServings,JSON.stringify(snapshotIngredients),totalCost,JSON.stringify(totalNutrition),JSON.stringify(outcome.intakeNutrition),snapshot.cookingOilGrams,snapshot.intakeCookingOilGrams,sqlDate(snapshot.completedAt)])
      let prepared:PreparedFoodStock|null=null;if(outcome.preparedServings>0){prepared={id:this.createId(),cookingSnapshotId:snapshotId,recipeId:session.recipeId,recipeVersionId:session.recipeVersionId,portionsCreated:outcome.preparedServings,portionsRemaining:outcome.preparedServings,nutritionRemaining:outcome.preparedNutrition,cookingOilGramsRemaining:outcome.preparedCookingOilGrams,costRemainingMinor:round(totalCost*outcome.preparedServings/input.madeServings),createdAt:timestamp};await connection.execute(`INSERT INTO life_prepared_food_stock (id,user_id,cooking_snapshot_id,recipe_id,recipe_version_id,portions_created,portions_remaining,nutrition_remaining,cooking_oil_grams_remaining,cost_remaining_minor,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[prepared.id,userId,snapshotId,prepared.recipeId,prepared.recipeVersionId,prepared.portionsCreated,prepared.portionsRemaining,JSON.stringify(prepared.nutritionRemaining),prepared.cookingOilGramsRemaining,prepared.costRemainingMinor,sqlDate(timestamp)])}
      await connection.execute("UPDATE life_cooking_sessions SET status='completed',completed_at=?,entity_version=entity_version+1 WHERE user_id=? AND id=?",[sqlDate(snapshot.completedAt),userId,sessionId]);return{snapshot,preparedFood:prepared,intake:{servings:input.eatenServings,nutrition:outcome.intakeNutrition,cookingOilGrams:outcome.intakeCookingOilGrams,costMinor:round(totalCost*input.eatenServings/input.madeServings)}}})
  }
  async listPreparedFood(userId:string){const found=await rows<SqlRow>(this.pool,'SELECT * FROM life_prepared_food_stock WHERE user_id=? ORDER BY created_at,id',[userId]);return found.map((row)=>({id:String(row.id),cookingSnapshotId:String(row.cooking_snapshot_id),recipeId:String(row.recipe_id),recipeVersionId:String(row.recipe_version_id),portionsCreated:Number(row.portions_created),portionsRemaining:Number(row.portions_remaining),nutritionRemaining:parse<PreparedFoodStock['nutritionRemaining']>(row.nutrition_remaining),cookingOilGramsRemaining:Number(row.cooking_oil_grams_remaining),costRemainingMinor:Number(row.cost_remaining_minor),createdAt:iso(row.created_at)}))}

  async exportOwnerPortableDataFrom(executor:Executor,userId:string){
    const recipeRows=await rows<SqlRow>(executor,'SELECT * FROM life_recipes WHERE user_id=? ORDER BY created_at,id',[userId])
    const versionRows=await rows<SqlRow>(executor,'SELECT * FROM life_recipe_versions WHERE user_id=? ORDER BY created_at,id',[userId])
    const sessionRows=await rows<SqlRow>(executor,'SELECT * FROM life_cooking_sessions WHERE user_id=? ORDER BY created_at,id',[userId])
    const snapshotRows=await rows<SqlRow>(executor,'SELECT * FROM life_cooking_snapshots WHERE user_id=? ORDER BY completed_at,id',[userId])
    const preparedRows=await rows<SqlRow>(executor,'SELECT * FROM life_prepared_food_stock WHERE user_id=? ORDER BY created_at,id',[userId])
    return{
      recipes:await Promise.all(recipeRows.map((row)=>this.mapRecipe(executor,userId,row))),
      recipeVersions:await Promise.all(versionRows.map((row)=>this.mapVersion(executor,userId,row))),
      cookingSessions:sessionRows.map((row)=>({
        id:String(row.id),recipeId:String(row.recipe_id),recipeVersionId:String(row.recipe_version_id),
        plannedServings:Number(row.planned_servings),note:String(row.note),entityVersion:Number(row.entity_version),
        progress:parse(row.progress_json),status:row.status as CookingSession['status'],createdAt:iso(row.created_at),
        completedAt:row.completed_at==null?null:iso(row.completed_at),
      })),
      cookingCompletions:snapshotRows.map((row)=>({
        id:String(row.id),cookingSessionId:String(row.cooking_session_id),recipeId:String(row.recipe_id),
        recipeVersionId:String(row.recipe_version_id),madeServings:Number(row.made_servings),eatenServings:Number(row.eaten_servings),
        ingredients:parse(row.ingredients_snapshot),totalCostMinor:Number(row.total_cost_minor),totalNutrition:parse(row.total_nutrition),
        intakeNutrition:parse(row.intake_nutrition),cookingOilGrams:Number(row.cooking_oil_grams),
        intakeCookingOilGrams:Number(row.intake_cooking_oil_grams),completedAt:iso(row.completed_at),
      })),
      preparedFood:preparedRows.map((row)=>({
        id:String(row.id),cookingSnapshotId:String(row.cooking_snapshot_id),recipeId:String(row.recipe_id),
        recipeVersionId:String(row.recipe_version_id),portionsCreated:Number(row.portions_created),
        portionsRemaining:Number(row.portions_remaining),nutritionRemaining:parse(row.nutrition_remaining),
        cookingOilGramsRemaining:Number(row.cooking_oil_grams_remaining),costRemainingMinor:Number(row.cost_remaining_minor),
        createdAt:iso(row.created_at),
      })),
    }
  }

  private async calculation(userId:string,version:RecipeVersion,asOf:string,targetServings?:number){return this.calculationFrom(this.pool,userId,version,asOf,targetServings)}
  private async calculationFrom(executor:Executor,userId:string,version:RecipeVersion,asOf:string,targetServings?:number){return calculateRecipe({version,items:await this.options.listCatalogItemsFrom(executor,userId),units:await this.options.listUnitsFrom(executor,userId),balances:await this.options.listInventoryBalancesFrom(executor,userId),asOf,targetServings})}
  private async validateInput(userId:string,input:CreateRecipeInput){
    if(!input.name?.trim()||!Number.isFinite(input.servings)||input.servings<=0||!input.components?.length)throw new LifeRecipesDomainError('INVALID_INPUT','A recipe name, positive servings and components are required.')
    const ids=new Set<string>()
    for(const component of input.components){const item=await this.options.getCatalogItem(userId,component.itemId);if(!item||item.kind!=='ingredient'||item.status!=='active'||item.deletedAt)throw new LifeRecipesDomainError('NOT_FOUND','A recipe ingredient does not exist.',404);if(ids.has(component.itemId))throw new LifeRecipesDomainError('DUPLICATE_COMPONENT','A recipe ingredient can appear only once.',409);ids.add(component.itemId)}
    if(input.categoryId){const categories=await this.options.listTaxonomy(userId,'category');if(!categories.some((entry)=>entry.id===input.categoryId&&entry.status==='active'))throw new LifeRecipesDomainError('NOT_FOUND','The recipe category does not exist.',404)}
    if(input.coverMediaId&&!await this.options.getMediaAsset(userId,input.coverMediaId))throw new LifeRecipesDomainError('NOT_FOUND','Recipe cover media does not exist.',404)
    if(input.tagIds?.length){const tags=await this.options.listTaxonomy(userId,'tag');const activeTagIds=new Set(tags.filter((entry)=>entry.status==='active').map((entry)=>entry.id));if(input.tagIds.some((id)=>!activeTagIds.has(id)))throw new LifeRecipesDomainError('NOT_FOUND','A recipe tag does not exist.',404)}
    for(const step of input.steps){for(const id of step.ingredientItemIds)if(!ids.has(id))throw new LifeRecipesDomainError('INVALID_STEP_REFERENCE','A recipe step references an ingredient outside the recipe.',409);if(step.imageMediaId&&!await this.options.getMediaAsset(userId,step.imageMediaId))throw new LifeRecipesDomainError('NOT_FOUND','Recipe step media does not exist.',404)}
  }
  private buildVersion(recipeId:string,number:number,input:RecipeVersionInput,timestamp:string,promotedNote:string|null=null):RecipeVersion{return{id:this.createId(),recipeId,number,servings:input.servings,yieldQuantity:input.yieldQuantity??null,yieldUnit:input.yieldUnit?.trim()||null,components:[...input.components].sort((a,b)=>a.position-b.position).map((value)=>({...value,id:this.createId(),unit:value.unit.trim().toLowerCase()})),steps:[...input.steps].sort((a,b)=>a.position-b.position).map((value)=>({...value,id:this.createId(),instruction:value.instruction.trim(),ingredientItemIds:[...new Set(value.ingredientItemIds)],caution:value.caution.trim()})),promotedNote,createdAt:timestamp}}
  private async insertVersion(connection:PoolConnection,userId:string,recipeId:string,number:number,input:RecipeVersionInput,timestamp:string){const version=this.buildVersion(recipeId,number,input,timestamp);await this.insertExistingVersion(connection,userId,version);return version}
  private async insertExistingVersion(connection:PoolConnection,userId:string,version:RecipeVersion){await connection.execute('INSERT INTO life_recipe_versions (id,user_id,recipe_id,version_number,servings,yield_quantity,yield_unit,promoted_note,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[version.id,userId,version.recipeId,version.number,version.servings,version.yieldQuantity,version.yieldUnit,version.promotedNote,sqlDate(version.createdAt)]);for(const component of version.components)await connection.execute('INSERT INTO life_recipe_components (id,user_id,recipe_version_id,item_id,quantity,unit,component_role,position) VALUES (?,?,?,?,?,?,?,?)',[component.id,userId,version.id,component.itemId,component.quantity,component.unit,component.role,component.position]);for(const step of version.steps)await connection.execute('INSERT INTO life_recipe_steps (id,user_id,recipe_version_id,instruction,ingredient_item_ids,duration_seconds,image_media_id,caution,position) VALUES (?,?,?,?,?,?,?,?,?)',[step.id,userId,version.id,step.instruction,JSON.stringify(step.ingredientItemIds),step.durationSeconds,step.imageMediaId,step.caution,step.position])}
  private async mapRecipe(executor:Executor,userId:string,row:SqlRow):Promise<Recipe>{return{id:String(row.id),name:String(row.name),description:String(row.description),coverMediaId:row.cover_media_id==null?null:String(row.cover_media_id),prepMinutes:Number(row.prep_minutes),cookMinutes:Number(row.cook_minutes),difficulty:row.difficulty as Recipe['difficulty'],categoryId:row.category_id==null?null:String(row.category_id),tagIds:parse(row.tag_ids),storageNotes:String(row.storage_notes),entityVersion:Number(row.entity_version),currentVersion:await this.loadVersion(executor,userId,String(row.current_version_id)),createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),deletedAt:row.deleted_at==null?null:iso(row.deleted_at)}}
  private async loadVersion(executor:Executor,userId:string,id:string){const found=await rows<SqlRow>(executor,'SELECT * FROM life_recipe_versions WHERE user_id=? AND id=? LIMIT 1',[userId,id]);if(!found[0])throw new LifeRecipesDomainError('RECIPE_VERSION_NOT_FOUND','The requested recipe version does not exist.',404);return this.mapVersion(executor,userId,found[0])}
  private async mapVersion(executor:Executor,userId:string,row:SqlRow):Promise<RecipeVersion>{const components=await rows<SqlRow>(executor,'SELECT * FROM life_recipe_components WHERE user_id=? AND recipe_version_id=? ORDER BY position,id',[userId,row.id]);const steps=await rows<SqlRow>(executor,'SELECT * FROM life_recipe_steps WHERE user_id=? AND recipe_version_id=? ORDER BY position,id',[userId,row.id]);return{id:String(row.id),recipeId:String(row.recipe_id),number:Number(row.version_number),servings:Number(row.servings),yieldQuantity:row.yield_quantity==null?null:Number(row.yield_quantity),yieldUnit:row.yield_unit==null?null:String(row.yield_unit),components:components.map((value)=>({id:String(value.id),itemId:String(value.item_id),quantity:Number(value.quantity),unit:String(value.unit),role:value.component_role as 'ingredient'|'seasoning',position:Number(value.position)})),steps:steps.map((value)=>({id:String(value.id),instruction:String(value.instruction),ingredientItemIds:parse(value.ingredient_item_ids),durationSeconds:value.duration_seconds==null?null:Number(value.duration_seconds),imageMediaId:value.image_media_id==null?null:String(value.image_media_id),caution:String(value.caution),position:Number(value.position)})),promotedNote:row.promoted_note==null?null:String(row.promoted_note),createdAt:iso(row.created_at)}}
  private async session(executor:Executor,userId:string,id:string,lock=false):Promise<CookingSession|undefined>{const found=await rows<SqlRow>(executor,`SELECT * FROM life_cooking_sessions WHERE user_id=? AND id=? LIMIT 1${lock?' FOR UPDATE':''}`,[userId,id]);const row=found[0];return row?{id:String(row.id),recipeId:String(row.recipe_id),recipeVersionId:String(row.recipe_version_id),plannedServings:Number(row.planned_servings),note:String(row.note),entityVersion:Number(row.entity_version),progress:parse(row.progress_json),status:row.status as 'active'|'completed',createdAt:iso(row.created_at),completedAt:row.completed_at==null?null:iso(row.completed_at)}:undefined}
  private async validateCookingProgress(userId:string,session:CookingSession,input:UpdateCookingSessionInput){const version=await this.loadVersion(this.pool,userId,session.recipeVersionId);if(!Number.isInteger(input.currentStepIndex)||input.currentStepIndex<0||input.currentStepIndex>version.steps.length)throw new LifeRecipesDomainError('INVALID_INPUT','The current cooking step is invalid.');const stepIds=new Set(version.steps.map((step)=>step.id));if(new Set(input.completedStepIds).size!==input.completedStepIds.length||input.completedStepIds.some((id)=>!stepIds.has(id)))throw new LifeRecipesDomainError('INVALID_INPUT','Completed cooking steps must belong to this recipe version.');const timerStepIds=new Set<string>();for(const timer of input.timers){if(!stepIds.has(timer.stepId)||timerStepIds.has(timer.stepId)||!Number.isInteger(timer.elapsedSeconds)||timer.elapsedSeconds<0)throw new LifeRecipesDomainError('INVALID_INPUT','Cooking timers must be unique, non-negative and belong to this recipe version.');timerStepIds.add(timer.stepId);if(timer.startedAt!=null&&Number.isNaN(Date.parse(timer.startedAt)))throw new LifeRecipesDomainError('INVALID_DATE','The cooking timer timestamp is invalid.')};const componentIds=new Set(version.components.map((component)=>component.itemId));const actualItemIds=new Set<string>();const coveredComponentIds=new Set<string>();for(const actual of input.actualIngredients){if(!Number.isFinite(actual.quantity)||actual.quantity<=0)throw new LifeRecipesDomainError('INVALID_INPUT','actual ingredient quantity must be positive.');if(actualItemIds.has(actual.itemId))throw new LifeRecipesDomainError('DUPLICATE_COMPONENT','An actual ingredient can appear only once.',409);actualItemIds.add(actual.itemId);const sourceId=actual.replacesItemId??actual.itemId;if(!componentIds.has(sourceId)||coveredComponentIds.has(sourceId))throw new LifeRecipesDomainError('INVALID_SUBSTITUTION','Each actual ingredient must map to one recipe component.',409);coveredComponentIds.add(sourceId);const item=await this.options.getCatalogItem(userId,actual.itemId);if(!item||item.deletedAt!=null||item.status!=='active'||item.kind!=='ingredient')throw new LifeRecipesDomainError('NOT_FOUND','An actual cooking ingredient does not exist.',404)}return structuredClone({currentStepIndex:input.currentStepIndex,completedStepIds:input.completedStepIds,actualIngredients:input.actualIngredients.map((value)=>({...value,unit:value.unit.trim().toLowerCase()})),timers:input.timers.map((value)=>({...value,startedAt:value.startedAt==null?null:new Date(value.startedAt).toISOString()}))})}
  private resolveActualVersion(version:RecipeVersion,session:CookingSession,madeServings:number):RecipeVersion{if(!session.progress.actualIngredients.length)return version;const covered=new Set(session.progress.actualIngredients.map((actual)=>actual.replacesItemId??actual.itemId));if(version.components.some((component)=>!covered.has(component.itemId)))throw new LifeRecipesDomainError('INCOMPLETE_ACTUAL_INGREDIENTS','Actual cooking quantities must account for every recipe component.',409);if(!Number.isFinite(madeServings)||madeServings<=0)throw new LifeRecipesDomainError('INVALID_INPUT','madeServings must be positive.');return{...structuredClone(version),servings:madeServings,components:session.progress.actualIngredients.map((actual,index)=>{const source=version.components.find((component)=>component.itemId===(actual.replacesItemId??actual.itemId))!;return{id:`${session.id}-actual-${index}`,itemId:actual.itemId,quantity:actual.quantity,unit:actual.unit,role:source.role,position:index}})}}
  private assertVersion(recipe:Recipe,expected:number){if(recipe.entityVersion!==expected)throw new LifeRecipesDomainError('VERSION_CONFLICT','The recipe changed since it was loaded.',409)}
  private async idempotently<T>(userId:string,operation:string,keyRaw:string,input:unknown,create:(connection:PoolConnection)=>Promise<T>):Promise<T>{const key=keyRaw.trim();if(!key||key.length>190)throw new LifeRecipesDomainError('INVALID_IDEMPOTENCY_KEY','A valid idempotency key is required.');const hash=requestHash(input),connection=await this.pool.getConnection();try{await connection.beginTransaction();await connection.execute('INSERT IGNORE INTO life_recipe_idempotency (user_id,operation_key,idempotency_key,request_hash,response_json,created_at) VALUES (?,?,?,?,NULL,?)',[userId,operation,key,hash,sqlDate(this.now())]);const found=(await rows<SqlRow>(connection,'SELECT * FROM life_recipe_idempotency WHERE user_id=? AND operation_key=? AND idempotency_key=? FOR UPDATE',[userId,operation,key]))[0];if(String(found.request_hash)!==hash)throw new LifeRecipesDomainError('IDEMPOTENCY_CONFLICT','The idempotency key belongs to another recipe request.',409);if(found.response_json!=null){const response=parse<T>(found.response_json);await connection.commit();return response}const result=await create(connection);await connection.execute('UPDATE life_recipe_idempotency SET response_json=? WHERE user_id=? AND operation_key=? AND idempotency_key=?',[JSON.stringify(result),userId,operation,key]);await connection.commit();return structuredClone(result)}catch(error){await connection.rollback();throw error}finally{connection.release()}}
}
