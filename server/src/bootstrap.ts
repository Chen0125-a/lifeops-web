import { hashPassword } from './security/password.js'
import type { LifeStore } from './store/lifeStore.js'

export async function ensureBootstrapUser(
  store: LifeStore,
  input: { account: string; password: string; displayName: string },
) {
  const existing = await store.findUserByAccount(input.account)
  if (existing) return { created: false, user: existing }
  try {
    const user = await store.createUser({ account: input.account, displayName: input.displayName, passwordHash: await hashPassword(input.password) })
    return { created: true, user }
  } catch (error) {
    // Two replicas can start together. The unique account constraint elects one
    // winner; the loser re-reads that account instead of crash-looping forever.
    const winner = await store.findUserByAccount(input.account)
    if (winner) return { created: false, user: winner }
    throw error
  }
}
