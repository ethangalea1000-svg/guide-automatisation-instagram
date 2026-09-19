const fs = require('fs');

const CALENDRIER_PATH = 'content/calendrier.json';
const JOURNAL_PATH = 'content/journal.json';
const TODAY = new Date().toISOString().split('T')[0];
const calendrier = JSON.parse(fs.readFileSync(CALENDRIER_PATH, 'utf8'));
const journal = fs.existsSync(JOURNAL_PATH) ? JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8')) : [];

// Active/désactive le premier commentaire automatique (hashtags + question d'engagement)
const PREMIER_COMMENTAIRE_ACTIF = false;

function ajouterAuJournal(type, contenu, decision, raison) {
  journal.push({ date: new Date().toISOString(), type, contenu, decision, raison });
  fs.writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 2));
}

// Rattrape le post le plus ancien en attente, même si sa date est déjà passée
const post = calendrier
  .filter(p => p.date <= TODAY && p.statut === 'en_attente' && p.approuve === true)
  .sort((a, b) => a.date.localeCompare(b.date))[0];

if (!post) {
  console.log("Rien à publier aujourd'hui.");
  ajouterAuJournal('Publication', 'Aucun post en attente', 'Rien à faire', 'Calendrier vide ou tout déjà publié');
  process.exit(0);
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

function validateCaption(legende, hashtags) {
  if (typeof legende !== 'string' || !legende.trim() || legende.length > 2000) {
    throw new Error('Légende IA invalide ou trop longue');
  }
  if (!Array.isArray(hashtags) || hashtags.length > 8 ||
      hashtags.some(tag => typeof tag !== 'string' || !/^#[\p{L}\p{N}_]{1,50}$/u.test(tag))) {
    throw new Error('Hashtags IA invalides');
  }
  const unsafe = /\b(terme_sensible_1|terme_sensible_2)\b/i;
  if (unsafe.test(legende)) throw new Error('Contenu sensible détecté : publication annulée');
}

function validatePremierCommentaire(hashtagsSupplementaires, question) {
  if (!Array.isArray(hashtagsSupplementaires) || hashtagsSupplementaires.length > 15 ||
      hashtagsSupplementaires.some(tag => typeof tag !== 'string' || !/^#[\p{L}\p{N}_]{1,50}$/u.test(tag))) {
    throw new Error('Hashtags IA invalides');
  }
  if (typeof question !== 'string' || !question.trim() || question.length > 300) {
    throw new Error('Question IA du premier commentaire invalide ou trop longue');
  }
}

async function appelerIA(prompt) {
  const accountId = requireEnv('CF_ACCOUNT_ID');
  const token = requireEnv('CF_API_TOKEN');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], stream: false })
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error('Échec du service IA');
  return extraireResultatIA(data);
}

async function genererImage(sujet) {
  const accountId = requireEnv('CF_ACCOUNT_ID');
  const token = requireEnv('CF_API_TOKEN');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: `Photo professionnelle Instagram, style moderne, sujet : ${sujet}` })
  });
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) {
    throw new Error('Image IA invalide : publication annulée');
  }
  const formData = new URLSearchParams();
  formData.append('key', requireEnv('IMGBB_API_KEY'));
  formData.append('image', Buffer.from(await res.arrayBuffer()).toString('base64'));
  const uploadRes = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.success || typeof uploadData.data?.url !== 'string') {
    throw new Error('Hébergement image indisponible');
  }
  return uploadData.data.url;
}

async function genererPremierCommentaire(sujet) {
  const parsed = await appelerIA(
    `Pour un post Instagram sur le sujet : ${sujet}, génère un premier commentaire à publier juste après la publication, pour élargir la portée. ` +
    'Il doit contenir : (1) une liste de 10 à 15 hashtags différents de ceux déjà utilisés en légende, plus larges/génériques ; ' +
    '(2) une question courte pour encourager les abonnés à réagir, en lien avec le sujet. ' +
    'JSON strict : {"hashtags_supplementaires":["#..."],"question":"..."}'
  );
  validatePremierCommentaire(parsed.hashtags_supplementaires, parsed.question);
  return `${parsed.question}\n\n${parsed.hashtags_supplementaires.join(' ')}`;
}

async function posterPremierCommentaire(mediaId, texte) {
  const token = requireEnv('IG_ACCESS_TOKEN');
  const res = await fetch(`https://graph.instagram.com/v22.0/${mediaId}/comments?message=${encodeURIComponent(texte)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!res.ok || !data.id) throw new Error('Premier commentaire refusé');
  return data.id;
}

async function publier() {
  const parsed = await appelerIA(
    `Génère une légende Instagram informative et 8 hashtags maximum pour ce sujet : ${post.sujet}. ` +
    'JSON strict : {"legende":"...","hashtags":["#..."]}'
  );
  validateCaption(parsed.legende, parsed.hashtags);
  const imageUrl = await genererImage(post.sujet);
  const token = requireEnv('IG_ACCESS_TOKEN');
  const userId = requireEnv('IG_USER_ID');
  const base = `https://graph.instagram.com/v22.0/${userId}`;
  const auth = { Authorization: `Bearer ${token}` };
  const createRes = await fetch(`${base}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(`${parsed.legende}\n\n${parsed.hashtags.join(' ')}`)}`, { method: 'POST', headers: auth });
  const createData = await createRes.json();
  if (!createRes.ok || !createData.id) throw new Error('Création du média refusée');
  const publishRes = await fetch(`${base}/media_publish?creation_id=${createData.id}`, { method: 'POST', headers: auth });
  const publishData = await publishRes.json();
  if (!publishRes.ok || !publishData.id) throw new Error('Publication refusée');

  if (PREMIER_COMMENTAIRE_ACTIF) {
    try {
      const texteCommentaire = await genererPremierCommentaire(post.sujet);
      await posterPremierCommentaire(publishData.id, texteCommentaire);
    } catch (err) {
      console.error(`Premier commentaire non publié : ${err.message}`);
    }
  }

  post.statut = 'publie';
  fs.writeFileSync(CALENDRIER_PATH, JSON.stringify(calendrier, null, 2));
  ajouterAuJournal('Publication', post.sujet, 'Publié avec succès', `Média Instagram ID ${publishData.id}`);
  console.log(`Publication réussie : ${publishData.id}`);
}

publier().catch(err => {
  ajouterAuJournal('Publication', post.sujet, 'Échec', err.message);
  console.error(err.message);
  process.exit(1);
});
