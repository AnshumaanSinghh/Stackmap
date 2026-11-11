import posthog from 'posthog-js';
import { loadStripe } from '@stripe/stripe-js';
import { Button } from '@acme/ui';
import { getUser } from '@acme/db';

export default async function Page() {
  posthog.capture('view');
  const stripe = await loadStripe(process.env.NEXT_PUBLIC_STRIPE_KEY!);
  return <Button>{String(Boolean(stripe))}{String(await getUser())}</Button>;
}
