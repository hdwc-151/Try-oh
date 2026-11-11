import { Router } from 'express'
import type { PlanService } from './plan-service.js'

export const createPlanRouter = (plans: PlanService) => {
  const router = Router()
  router.get('/', async (request, response, next) => {
    try { response.json({ plans: plans.catalog(), current: await plans.status(request.authUser) }) }
    catch (error) { next(error) }
  })
  return router
}
