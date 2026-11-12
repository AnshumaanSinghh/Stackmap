import { db } from '@acme/db';

export default async function Page() {
  const { rows } = await db.query('select 1');
  return <main>{rows.length}</main>;
}
