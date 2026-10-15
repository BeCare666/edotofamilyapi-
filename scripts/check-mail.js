/*
 * Diagnostic de l'envoi d'e-mails (Brevo), sans rien envoyer par défaut.
 *   npm run mail:check                      → vérifie la clé, le compte et l'expéditeur
 *   npm run mail:check -- --to vous@mail.com → envoie en plus un vrai e-mail de test
 * À lancer AUSSI sur le serveur (Render, onglet Shell) : c'est son adresse IP qui compte.
 */
require('dotenv').config();

const SENDER = 'edotofamily@gmail.com';
const key = String(process.env.BREVO_API_KEY || '').trim();
const toIndex = process.argv.indexOf('--to');
const to = toIndex > -1 ? process.argv[toIndex + 1] : null;

async function brevo(path, init = {}) {
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    ...init,
    headers: { 'api-key': key, accept: 'application/json', 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

(async () => {
  if (!key) {
    console.log('ÉCHEC : BREVO_API_KEY est vide ou absente.');
    process.exit(1);
  }
  console.log(`Clé lue : ${key.slice(0, 8)}… (${key.length} caractères)`);

  const account = await brevo('/account');
  if (!account.ok) {
    console.log(`ÉCHEC compte Brevo (${account.status}) : ${account.body?.message || JSON.stringify(account.body)}`);
    if (/unrecognised IP/i.test(account.body?.message || '')) {
      console.log('CAUSE : Brevo bloque les adresses IP non autorisées.');
      console.log('SOLUTION : app.brevo.com > Sécurité > IP autorisées : désactiver le blocage,');
      console.log('ou ajouter les IP sortantes du serveur (Render > service > Connect > Outbound).');
    }
    process.exit(1);
  }
  console.log(`OK compte : ${account.body.email} ; offres : ${(account.body.plan || []).map((p) => `${p.type} (${p.credits ?? '?'} crédits)`).join(', ')}`);

  const senders = await brevo('/senders');
  const list = senders.body?.senders || [];
  const sender = list.find((s) => String(s.email).toLowerCase() === SENDER);
  if (!sender) console.log(`ÉCHEC : l'expéditeur ${SENDER} n'existe pas dans Brevo (expéditeurs : ${list.map((s) => s.email).join(', ') || 'aucun'}).`);
  else console.log(`Expéditeur ${SENDER} : ${sender.active ? 'actif' : 'INACTIF (à valider dans Brevo)'}`);

  if (to) {
    const sent = await brevo('/smtp/email', {
      method: 'POST',
      body: JSON.stringify({
        sender: { email: SENDER, name: 'E.doto family' },
        to: [{ email: to }],
        subject: 'Test d’envoi E.doto family',
        htmlContent: '<p>Ceci est un e-mail de test envoyé par E.doto family.</p>',
      }),
    });
    console.log(sent.ok ? `OK : e-mail de test envoyé à ${to} (${sent.body.messageId})` : `ÉCHEC envoi (${sent.status}) : ${sent.body?.message || JSON.stringify(sent.body)}`);
    process.exit(sent.ok ? 0 : 1);
  }
})().catch((e) => { console.log('ÉCHEC réseau :', e.message); process.exit(1); });
