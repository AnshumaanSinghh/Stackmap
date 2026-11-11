// Calls the Postmark API directly, without an SDK.
export async function notify(to: string) {
  await fetch('https://api.postmarkapp.com/email', { method: 'POST', body: JSON.stringify({ to }) });
}
