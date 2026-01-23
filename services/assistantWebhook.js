/**
 * Verify Identity Platform access token (Firebase ID token)
 * @param {Object} req - Express request object
 * @param {Object} admin - Firebase Admin SDK
 * @returns {Promise<Object|null>} Decoded token or null
 */
const verifyAssistantAccessToken = async (req, admin) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const idToken = authHeader.split('Bearer ')[1];
    return await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    console.error('Assistant token verification failed:', error);
    return null;
  }
};

/**
 * Resolve locale from Actions Builder request
 * @param {Object} body - Request body
 * @returns {string} 'nl' or 'en'
 */
const getAssistantLocale = (body) => {
  const locale = body?.user?.locale || body?.session?.languageCode || 'en';
  return locale.toLowerCase().startsWith('nl') ? 'nl' : 'en';
};

/**
 * Build Actions Builder webhook response
 * @param {string} speech - Response text
 * @returns {Object} Webhook response
 */
const buildAssistantResponse = (speech) => ({
  session: { params: {} },
  prompt: {
    override: false,
    firstSimple: { speech, text: speech }
  }
});

/**
 * Assistant response templates (NL/EN)
 */
const assistantTemplates = {
  nl: {
    missing_item: () => 'Welke item zoek je?',
    found: (name, location) => `Je ${name} ligt in ${location}.`,
    not_found: (name) => `Ik heb geen ${name} gevonden.`,
    multiple_matches: (name, list) => `Ik heb meerdere matches voor ${name}: ${list}.`,
    no_access: () => 'Ik heb geen toegang tot je items.'
  },
  en: {
    missing_item: () => 'Which item are you looking for?',
    found: (name, location) => `Your ${name} is in ${location}.`,
    not_found: (name) => `I could not find ${name}.`,
    multiple_matches: (name, list) => `I found multiple matches for ${name}: ${list}.`,
    no_access: () => 'I do not have access to your items.'
  }
};

/**
 * Find items by name (exact match, then prefix fallback)
 * @param {Object} admin - Firebase Admin SDK
 * @param {string} itemName - Item name to search for
 * @param {number} limit - Max items
 * @returns {Promise<Array>} Array of { id, data }
 */
const findItemsByName = async (admin, itemName, limit = 10) => {
  const db = admin.firestore();
  const trimmedName = itemName.trim();

  const exactSnap = await db
    .collectionGroup('items')
    .where('name', '==', trimmedName)
    .limit(limit)
    .get();

  if (!exactSnap.empty) {
    return exactSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  }

  try {
    const prefixSnap = await db
      .collectionGroup('items')
      .orderBy('name')
      .startAt(trimmedName)
      .endAt(`${trimmedName}\uf8ff`)
      .limit(limit)
      .get();

    return prefixSnap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  } catch (error) {
    if (error?.code === 9) {
      console.warn('Assistant prefix search failed (missing index). Skipping prefix lookup.');
      return [];
    }
    throw error;
  }
};

/**
 * Register Assistant webhook route
 * @param {Object} app - Express app
 * @param {Object} admin - Firebase Admin SDK
 */
const registerAssistantWebhook = (app, admin) => {
  /**
   * POST /assistant/webhook - Actions Builder webhook (read-only)
   * Headers: Authorization: Bearer <IdentityPlatform_ID_Token>
   * Body: {
   *   "handler": { "name": "FindItem" },
   *   "intent": { "name": "TrackMyHome.FindItem", "params": { "itemName": { "resolved": "paspoort" } } },
   *   "session": { "id": "...", "languageCode": "nl-NL", "params": {} },
   *   "user": { "locale": "nl-NL" }
   * }
   *
   * Response (found):
   * {
   *   "session": { "params": {} },
   *   "prompt": {
   *     "override": false,
   *     "firstSimple": { "speech": "Je paspoort ligt in de hal.", "text": "Je paspoort ligt in de hal." }
   *   }
   * }
   */
  app.post('/assistant/webhook', async (req, res) => {
    const locale = getAssistantLocale(req.body);
    const templates = assistantTemplates[locale];

    try {
      const itemName =
        req.body?.intent?.params?.itemName?.resolved ||
        req.body?.intent?.params?.itemName?.original ||
        req.body?.intent?.params?.itemName?.value;

      if (!itemName || typeof itemName !== 'string') {
        return res.json(buildAssistantResponse(templates.missing_item()));
      }

      const decodedToken = await verifyAssistantAccessToken(req, admin);
      if (!decodedToken?.uid) {
        return res.json(buildAssistantResponse(templates.no_access()));
      }

      const matches = await findItemsByName(admin, itemName, 10);
      if (matches.length === 0) {
        return res.json(buildAssistantResponse(templates.not_found(itemName)));
      }

      const parentIds = Array.from(
        new Set(matches.map((match) => match.data?.parentId).filter(Boolean))
      );

      const db = admin.firestore();
      const pakketDocs = await Promise.all(
        parentIds.map((parentId) => db.collection('pakkets').doc(parentId).get())
      );

      const pakketMap = new Map();
      pakketDocs.forEach((doc) => {
        if (doc.exists) {
          pakketMap.set(doc.id, doc.data());
        }
      });

      const enriched = matches.map((match) => {
        const data = match.data || {};
        const pakket = data.parentId ? pakketMap.get(data.parentId) : null;
        const pakketName = pakket?.name || (locale === 'nl' ? 'onbekende locatie' : 'unknown location');
        const uids = Array.isArray(pakket?.uids) ? pakket.uids : [];
        const memberRoles = pakket?.memberRoles || {};
        const hasAccess = uids.includes(decodedToken.uid) || Boolean(memberRoles[decodedToken.uid]);

        return {
          name: data.name || itemName,
          location: pakketName,
          hasAccess
        };
      });

      const accessible = enriched.filter((match) => match.hasAccess);
      if (accessible.length === 0) {
        return res.json(buildAssistantResponse(templates.no_access()));
      }

      if (accessible.length === 1) {
        const match = accessible[0];
        return res.json(buildAssistantResponse(templates.found(match.name, match.location)));
      }

      const list = accessible
        .slice(0, 3)
        .map((match) => `${match.name} (${match.location})`)
        .join(', ');

      return res.json(buildAssistantResponse(templates.multiple_matches(itemName, list)));
    } catch (error) {
      console.error('Assistant webhook error:', error);
      const fallback = locale === 'nl' ? 'Er ging iets mis.' : 'Something went wrong.';
      return res.status(500).json(buildAssistantResponse(fallback));
    }
  });
};

module.exports = {
  registerAssistantWebhook
};
