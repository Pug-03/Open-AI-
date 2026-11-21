export const SOS_CONFIRM_DELAY_MS: number;
export const SOS_LOCATION_MAX_AGE_MS: number;

export type SosLocation = { latitude: number; longitude: number; observedAt: number };
export type SosDelivery = 'provider_accepted' | 'delivery_unknown' | 'failed';
export interface SosOutboxAdapter {
  claimConfirmed(input: { ownerId: string; id: string; recipientId: string }): Promise<{ status: string; verifiedDestination?: string }>;
  recordResult(input: { id: string; status: SosDelivery }): Promise<void>;
  confirmRecipientReceipt(input: { id: string; recipientId: string }): Promise<{ status: string }>;
}

export function submitSos(
  input: { mode: 'practice' | 'live'; id: string; recipientId: string; location: SosLocation | null },
  deps: {
    actor: { id: string };
    outbox: SosOutboxAdapter;
    transport: { send(input: { idempotencyKey: string; verifiedDestination: string; location: SosLocation | null }): Promise<{ status: SosDelivery }> };
    now?: number;
  },
): Promise<{ status: string }>;

export function acknowledgeSos(
  input: { id: string },
  deps: { actor: { id: string }; outbox: SosOutboxAdapter },
): Promise<{ status: string }>;
