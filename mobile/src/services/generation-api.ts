import { ApiError, apiRequest } from './api-client';
import type { CreditStatus, TryOnResult } from '@/types/api';

type GenerationBody = { garmentIds: string[]; privacyConfirmed: boolean; preservePose: boolean };
type GenerationResult = TryOnResult & { credits: CreditStatus; outfitSaved?: boolean };
const receipts = new Map<string, { key: string; request?: Promise<GenerationResult> }>();

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
      if (error instanceof ApiError && error.status > 0 && error.code !== 'generation_in_progress') receipts.delete(fingerprint);
      throw error;
    }
  };
  entry.request = run();
  try { return await entry.request; }
  finally { entry.request = undefined; }
}
