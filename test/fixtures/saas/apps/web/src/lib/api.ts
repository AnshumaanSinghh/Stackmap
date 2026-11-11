export async function call(path: string) {
  return fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`);
}
