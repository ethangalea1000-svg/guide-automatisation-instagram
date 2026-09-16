const fs = require('fs');

// Personnalise ce thème selon ton propre sujet de compte
const THEME = 'sujets liés à [TON THÈME ICI — ex. voyage, cuisine, jardinage...]';

const CALENDRIER_PATH = 'content/calendrier.json';
const JOURNAL_PATH = 'content/journal.json';
const calendrier = fs.existsSync(CALENDRIER_PATH) ? JSON.parse(fs.readFileSync(CALENDRIER_PATH, 'utf8')) : [];
const journal = fs.existsSync(JOURNAL_PATH) ? JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')) : [];

function ajouterAuJournal(type, contenu, decision, raison) {
  journal.push({ date: new Date().toISOString(), type, contenu, decision, raison });
  fs.writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 2));
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Variable d'environnement manquante : ${name}`);
  return process.env[name];
}

function extraireJsonDeTexte(raw) {
  const debut = raw.indexOf('{');
  const fin = raw.lastIndexOf('}');
  if (debut === -1 || fin === -1 || fin < debut) throw new Error('Réponse IA non JSON');
  try {
    return JSON.parse(raw.slice(debut, fin + 1));
  } catch {
    throw new Error('Réponse IA non JSON');
  }
}

function extraireResultatIA(data) {
  const resultat = data.result;
  if (resultat && typeof resultat.response === 'object' && resultat.response !== null) {
    return resultat.response;
  }
  if (typeof resultat?.response === 'string' && resultat.response.trim()) {
    return extraireJsonDeTexte(resultat.response);
  }
  const contenu = resultat?.choices?.[0]?.message?.content;
  if (typeof contenu === 'string' && contenu.trim()) {
    return extraireJsonDeTexte(contenu);
  }
  throw new Error('Réponse IA non JSON');
}

async function genererSujets() {
  const accountId = requireEnv('CF_ACCOUNT_ID');
  const token = requireEnv('CF_API_TOKEN');
  const prompt = `Génère 7 idées de sujets de contenu sur le thème suivant : ${THEME}.
Réponds uniquement en JSON strict, sans aucun texte avant ou après : {"sujets":["...","...","...","...","...","...","..."]}`;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], stream: false })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error('Échec du service IA');
  const parsed = extraireResultatIA(data);
  if (!Array.isArray(parsed.sujets) || parsed.sujets.length !== 7 ||
      parsed.sujets.some(s => typeof s !== 'string' || !s.trim() || s.length > 180)) {
    throw new Error('Liste de sujets invalide');
  }
  return parsed.sujets;
}

async function planifier() {
  const sujets = await genererSujets();
  const dates = calendrier.map(p => p.date).sort();
  const dateCourante = dates.length ? new Date(dates[dates.length - 1]) : new Date();

  for (const sujet of sujets) {
    dateCourante.setDate(dateCourante.getDate() + 1);
    calendrier.push({
      date: dateCourante.toISOString().split('T')[0],
      sujet,
      statut: 'en_attente'
    });
  }

  fs.writeFileSync(CALENDRIER_PATH, JSON.stringify(calendrier, null, 2));
  ajouterAuJournal('Planification', `${sujets.length} sujets ajoutés`, 'Réussi', sujets.join(' | '));
}

planifier().catch(err => {
  ajouterAuJournal('Planification', 'Génération de sujets', 'Échec', err.message);
  console.error(err.message);
  process.exit(1);
});
