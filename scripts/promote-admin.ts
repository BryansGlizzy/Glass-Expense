// Usage: npm run admin:promote -- user@example.com
// Grants admin rights to an existing account (admin is no longer inferred from the ADMIN_EMAIL env var at request time).
import db from '../server/db.js';

const email = process.argv[2]?.trim();
if (!email) {
  console.error('Usage: npm run admin:promote -- <email>');
  process.exit(1);
}
const result = db.prepare('UPDATE users SET is_admin = 1 WHERE LOWER(email) = LOWER(?)').run(email);
if (result.changes === 0) {
  console.error(`No user found with email ${email}`);
  process.exit(1);
}
console.log(`Promoted ${email} to admin.`);
