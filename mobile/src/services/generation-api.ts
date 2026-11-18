import { ApiError, apiRequest } from './api-client';
import type { CreditStatus, TryOnResult } from '@/types/api';

type GenerationBody = { garmentIds: string[]; privacyConfirmed: boolean; preservePose: boolean; keepBackground: boolean };
type GenerationResult = TryOnResult & { credits: CreditStatus; outfitSaved?: boolean };
const receipts = new Map<string, { key: string; request?: Promise<GenerationResult> }>();
type GenerationReceipt = { status: number | null; body?: GenerationResult & { message?: string; code?: string } };

async function readGenerationReceipt(key: string) {
  for (const delay of [2_000, 6_000, 12_000, 20_000]) {
    await new Promise(resolve => setTimeout(resolve, delay));
    const receipt = await apiRequest<GenerationReceipt>('/api/generations/receipt', {
      headers: { 'Idempotency-Key': key }, timeoutMs: 5_000,
    }).catch(() => null);
    if (receipt && Number.isInteger(receipt.status) && receipt.body) return receipt;
  }
  return null;
}

/** Stable only for a retry of the same intent, never a cross-user image cache. */
export async function generateTryOn(
  angle: 'front' | 'back',
  body: GenerationBody,
  context: { userId: string; personImage: string; frontReference: string },
): Promise<GenerationResult> {
  const fingerprint = JSON.stringify([context, angle, body]);
  let receipt = receipts.get(fingerprint);
  if (receipt?.request) return receipt.request;
  if (!receipt) {
    receipt = { key: 'mobile-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) };
    receipts.set(fingerprint, receipt);
  }
  const entry = receipt;
  const run = async () => {
    try {
      const result = await apiRequest<GenerationResult>('/api/generations/angles/' + angle, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': entry.key },
        body: JSON.stringify(body),
      });
      receipts.delete(fingerprint);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status > 0 && error.status < 500 && error.code !== 'generation_in_progress') {
        receipts.delete(fingerprint);
        throw error;
      }
      const recovered = await readGenerationReceipt(entry.key);
      if (recovered?.status == null || !recovered.body) {
        throw new ApiError('Chưa xác nhận được kết quả. Hãy kiểm tra mục Outfit hoặc thử lại cùng lựa chọn.', 0, 'generation_unconfirmed');
      }
      receipts.delete(fingerprint);
      if (recovered.status >= 300) throw new ApiError(recovered.body.message ?? 'Không thể tạo ảnh.', recovered.status, recovered.body.code);
      return recovered.body;
    }
  };
  entry.request = run();
  try { return await entry.request; }
  finally { entry.request = undefined; }
}
