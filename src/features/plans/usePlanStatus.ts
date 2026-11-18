import { useCallback, useEffect, useState } from 'react'
import { planApi } from '../../services/plan-api'
import type { PlanSnapshot } from '../../types/plans'

export const usePlanStatus = () => {
  const [snapshot, setSnapshot] = useState<PlanSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setSnapshot(await planApi.get()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải gói đăng ký.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void reload() }, [reload])
  return { snapshot, loading, error, reload }
}
