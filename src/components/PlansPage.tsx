import { ArrowLeft, Check, Crown, LoaderCircle, QrCode, WalletCards } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AppView } from '../navigation'
import type { PlanSnapshot, SubscriptionPlan } from '../types/plans'
import type { PaymentProvider } from '../types/billing'
import { billingApi } from '../services/billing-api'

type PlansPageProps = {
  snapshot: PlanSnapshot | null
  loading: boolean
  error: string | null
  onNavigate: (view: AppView) => void
  onReload: () => void
}

const money = new Intl.NumberFormat('vi-VN')

export function PlansPage({ snapshot, loading, error, onNavigate, onReload }: PlansPageProps) {
  const [checkoutKey, setCheckoutKey] = useState<string | null>(null)
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const orderId = params.get('order')
    const payment = params.get('payment')
    if (payment === 'cancelled') {
      setPaymentMessage('Bạn đã hủy thanh toán. Gói hiện tại không thay đổi.')
      return
    }
    if (payment !== 'pending' || !orderId) return
    let active = true
    let attempts = 0
    setPaymentMessage('Đang xác nhận thanh toán…')
    const check = async () => {
      try {
        const order = await billingApi.getOrder(orderId)
        if (!active) return
        if (order.status === 'paid') {
          setPaymentMessage('Thanh toán thành công. Gói của bạn đã được kích hoạt.')
          window.history.replaceState(null, '', window.location.pathname)
          onReload()
          return
        }
        if (order.status === 'failed' || order.status === 'cancelled') {
          setPaymentMessage(null)
          setPaymentError('Thanh toán chưa thành công. Bạn có thể thử lại bằng VietQR hoặc MoMo.')
          return
        }
        attempts += 1
        if (attempts < 15) window.setTimeout(check, 2000)
        else setPaymentMessage('Giao dịch đang được xử lý. Vui lòng tải lại trang sau ít phút.')
      } catch (cause) {
        if (active) setPaymentError(cause instanceof Error ? cause.message : 'Không thể kiểm tra giao dịch.')
      }
    }
    void check()
    return () => { active = false }
  }, [onReload])

  const checkout = async (planId: SubscriptionPlan['id'], provider: PaymentProvider) => {
    setPaymentError(null)
    setPaymentMessage(null)
    const key = planId + ':' + provider
    setCheckoutKey(key)
    try {
      const session = await billingApi.createCheckout(planId, provider)
      window.location.assign(session.checkoutUrl)
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : 'Không thể bắt đầu thanh toán.')
      setCheckoutKey(null)
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-6 sm:py-7 lg:px-8 lg:py-9">
      <section className="overflow-hidden rounded-[32px] bg-[radial-gradient(circle_at_top_right,rgba(250,204,21,0.22),transparent_34%),linear-gradient(135deg,#111714,#273a2e)] px-5 py-7 text-white shadow-xl sm:px-9 sm:py-10">
        <button type="button" onClick={() => onNavigate('settings')} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white/75 transition hover:bg-white/15"><ArrowLeft size={14}/>Cài đặt</button>
        <div className="mt-8 max-w-2xl">
          <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200"><Crown size={14}/>Fitsy membership</span>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-5xl">Chọn không gian phù hợp với gu của bạn</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-white/60">Mở rộng lượt tạo ảnh, tủ đồ và số outfit có thể lưu. Bạn vẫn có thể dùng gói Free mà không cần nhập thông tin thanh toán.</p>
        </div>
      </section>

      {loading && !snapshot ? <div className="grid min-h-72 place-items-center text-ink/35"><LoaderCircle className="animate-spin"/></div> : error && !snapshot ? (
        <div className="mt-6 rounded-3xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700"><p>{error}</p><button onClick={onReload} className="mt-4 rounded-full bg-red-600 px-4 py-2 text-xs font-bold text-white">Thử lại</button></div>
      ) : snapshot && (
        <>
          {(paymentMessage || paymentError) && <div role="status" className={'mt-6 rounded-2xl border px-4 py-3 text-sm ' + (paymentError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>{paymentError ?? paymentMessage}</div>}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/[0.06] bg-panel px-4 py-3 shadow-sm">
            <p className="text-sm text-ink/55">Gói hiện tại: <strong className="text-ink">{snapshot.current.planName}</strong>{snapshot.current.unlimited && ' · Không giới hạn'}</p>
            <span className="rounded-full bg-sage-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-sage-800">Giá đề xuất</span>
          </div>
          <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Các gói đăng ký">
            {snapshot.plans.map((plan) => <PlanCard key={plan.id} plan={plan} current={snapshot.current.planId === plan.id && !snapshot.current.unlimited} checkoutKey={checkoutKey} onCheckout={checkout}/>) }
          </section>
        </>
      )}
    </main>
  )
}

function PlanCard({ plan, current, checkoutKey, onCheckout }: { plan: SubscriptionPlan; current: boolean; checkoutKey: string | null; onCheckout: (planId: SubscriptionPlan['id'], provider: PaymentProvider) => void }) {
  return <article className={`relative flex min-h-[420px] flex-col rounded-[28px] border p-5 transition sm:p-6 ${plan.recommended ? 'border-sage-600 bg-[#17211d] text-white shadow-xl' : 'border-black/[0.07] bg-panel text-ink shadow-sm'}`}>
    {plan.recommended && <span className="absolute right-4 top-4 rounded-full bg-amber-300 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-[#17211d]">Đề xuất</span>}
    <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${plan.recommended ? 'text-emerald-200' : 'text-sage-700'}`}>Fitsy {plan.name}</p>
    <p className="mt-5 font-display text-3xl font-bold">{plan.monthlyPriceVnd === 0 ? 'Miễn phí' : `${money.format(plan.monthlyPriceVnd)}đ`}</p>
    {plan.monthlyPriceVnd > 0 && <p className={`mt-1 text-xs ${plan.recommended ? 'text-white/45' : 'text-ink/40'}`}>mỗi tháng · giá đề xuất</p>}
    <p className={`mt-4 min-h-12 text-sm leading-6 ${plan.recommended ? 'text-white/60' : 'text-ink/50'}`}>{plan.description}</p>
    <ul className={`mt-6 space-y-3 border-t pt-5 text-sm ${plan.recommended ? 'border-white/10' : 'border-black/[0.07]'}`}>
      {plan.highlights.map(item => <li key={item} className="flex gap-2.5"><span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${plan.recommended ? 'bg-emerald-300 text-[#17211d]' : 'bg-sage-100 text-sage-800'}`}><Check size={12} strokeWidth={3}/></span><span>{item}</span></li>)}
      <li className="flex gap-2.5"><span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${plan.recommended ? 'bg-emerald-300 text-[#17211d]' : 'bg-sage-100 text-sage-800'}`}><Check size={12} strokeWidth={3}/></span><span>Chọn tối đa {plan.entitlements.selectedGarments} món mỗi lần tạo</span></li>
    </ul>
    {plan.id === 'free' ? (
      <button type="button" disabled className={'mt-auto w-full rounded-2xl px-4 py-3 text-xs font-bold ' + (current ? 'bg-sage-100 text-sage-800' : 'bg-black/[0.06] text-ink/35')}>{current ? 'Gói hiện tại' : 'Luôn có sẵn'}</button>
    ) : (
      <div className="mt-auto space-y-2 pt-5">
        {current && <p className={'text-center text-[10px] font-bold uppercase tracking-wider ' + (plan.recommended ? 'text-emerald-200' : 'text-sage-700')}>Gói hiện tại · có thể gia hạn</p>}
        <button type="button" disabled={checkoutKey !== null} onClick={() => onCheckout(plan.id, 'payos')} className={'flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-xs font-bold transition disabled:opacity-50 ' + (plan.recommended ? 'bg-white text-[#17211d] hover:bg-emerald-50' : 'bg-[#17211d] text-white hover:bg-[#24342c]')}>
          {checkoutKey === plan.id + ':payos' ? <LoaderCircle size={15} className="animate-spin"/> : <QrCode size={15}/>} VietQR
        </button>
        <button type="button" disabled={checkoutKey !== null} onClick={() => onCheckout(plan.id, 'momo')} className={'flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-xs font-bold transition disabled:opacity-50 ' + (plan.recommended ? 'border-white/20 bg-[#a50064] text-white hover:bg-[#b3006d]' : 'border-[#a50064]/20 bg-[#a50064] text-white hover:bg-[#b3006d]')}>
          {checkoutKey === plan.id + ':momo' ? <LoaderCircle size={15} className="animate-spin"/> : <WalletCards size={15}/>} MoMo
        </button>
      </div>
    )}
  </article>
}
