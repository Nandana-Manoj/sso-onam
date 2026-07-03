// Create (or upgrade) a single STAGING account into a "sadya rep" for testing
// the event-day QR scan/redeem flow in isolation.
//
//   node --env-file=.env.staging web/scripts/make-sadya-rep.mjs --yes
//   node --env-file=.env.staging web/scripts/make-sadya-rep.mjs --yes --mobile=+919999000050 --name="Test Sadya Rep"
//
// A sadya rep is a resident with profiles.is_sadya_rep = true (Phase 3). This
// script creates a resident (service role → bypasses RLS, no admin JWT needed)
// and flips the flag directly, mirroring grant_sadya_rep. The mobile defaults
// to the +919999000 sentinel range so reset-staging cleanup removes it too.

import { SENT, loadEnv, confirmTarget, admin, makeUser } from './_lib.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const mobile = arg('mobile', `${SENT.mobilePrefix}050`); // +919999000050
const name = arg('name', 'Test Sadya Rep');

const env = loadEnv();
confirmTarget(env, `MAKE sadya rep (${mobile} · ${name})`);
const db = admin(env);

async function main() {
  // If the account already exists, just flip the flag; otherwise create it.
  const { data: existing, error: selErr } = await db
    .from('profiles')
    .select('id')
    .eq('mobile', mobile)
    .maybeSingle();
  if (selErr) throw new Error(`select profiles: ${selErr.message}`);

  let id = existing?.id;
  if (id) {
    console.log(`Account ${mobile} already exists — granting sadya-rep flag.`);
  } else {
    console.log(`Creating resident ${mobile}…`);
    id = await makeUser(db, { mobile, name, role: 'resident' });
  }

  const { error: updErr } = await db
    .from('profiles')
    .update({ is_sadya_rep: true })
    .eq('id', id);
  if (updErr) throw new Error(`set is_sadya_rep: ${updErr.message}`);

  console.log('\n✔ Sadya rep ready.\n');
  console.log(`  Mobile   : ${mobile}`);
  console.log(`  Password : ${SENT.password}`);
  console.log(`  Role     : resident  (is_sadya_rep = true)`);
  console.log(`  Profile  : ${id}\n`);
  console.log('  Log in on the staging site and open the sadya scan/redeem screen.\n');
}

main().catch((e) => {
  console.error('\n✖ Failed:', e.message, '\n');
  process.exit(1);
});
