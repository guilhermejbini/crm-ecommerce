// Ligações reais da pesquisa de satisfação: Firestore (via firebase-admin, conta de serviço do servidor)
// e WhatsApp Cloud API (Meta). Usado só pelo server.ts; nunca é carregado no navegador.

import crypto from 'crypto';
import { initializeApp, getApps, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import type { SurveyStore, SurveySender, SendResult } from './satisfactionSurveyEngine';
import {
  SURVEYS_COL,
  SURVEY_CONTACTS_COL,
  SURVEY_OPTOUTS_COL,
  SURVEY_SETTINGS_DOC,
  SatisfactionSurveyRecord,
  SurveyPurchase
} from './satisfactionSurveyRules';

const LOCK_DOC = 'survey_runs/lock';

let adminApp: App | null = null;
let adminDb: Firestore | null = null;

export function getAdminDb(projectId: string, databaseId: string): Firestore {
  if (adminDb) return adminDb;
  adminApp = getApps().find(a => a.name === 'crm-survey') || initializeApp({
    credential: applicationDefault(),
    projectId
  }, 'crm-survey');
  adminDb = databaseId && databaseId !== '(default)' ? getFirestore(adminApp, databaseId) : getFirestore(adminApp);
  return adminDb;
}

export function createFirestoreSurveyStore(db: Firestore): SurveyStore {
  const lockOwner = crypto.randomUUID();
  const surveys = db.collection(SURVEYS_COL);

  const toRecord = (snap: FirebaseFirestore.DocumentSnapshot): SatisfactionSurveyRecord =>
    ({ id: snap.id, ...(snap.data() as Omit<SatisfactionSurveyRecord, 'id'>) });

  return {
    async getSettings() {
      const snap = await db.collection('settings').doc(SURVEY_SETTINGS_DOC).get();
      return snap.exists ? (snap.data() as any) : null;
    },

    async listPurchasesSince(sinceIso) {
      const snap = await db.collection('purchases')
        .where('purchaseDate', '>=', sinceIso)
        .select('customerId', 'storeId', 'storeName', 'purchaseDate', 'netAmount', 'totalAmount')
        .get();
      return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<SurveyPurchase, 'id'>) }));
    },

    async existingSurveyIds(ids) {
      const found = new Set<string>();
      for (let i = 0; i < ids.length; i += 300) {
        const refs = ids.slice(i, i + 300).map(id => surveys.doc(id));
        if (refs.length === 0) continue;
        const snaps = await db.getAll(...refs, { fieldMask: ['status'] });
        snaps.forEach(s => { if (s.exists) found.add(s.id); });
      }
      return found;
    },

    async getCustomer(id) {
      const snap = await db.collection('customers').doc(id).get();
      if (!snap.exists) return null;
      const d = snap.data() as any;
      return { id: snap.id, name: d.name, whatsapp: d.whatsapp, phone: d.phone, isAnonymized: d.isAnonymized, consent: d.consent };
    },

    async getContact(customerId) {
      const snap = await db.collection(SURVEY_CONTACTS_COL).doc(customerId).get();
      return snap.exists ? (snap.data() as any) : null;
    },

    async isPhoneOptedOut(phone) {
      const snap = await db.collection(SURVEY_OPTOUTS_COL).doc(phone).get();
      return snap.exists;
    },

    async hasOpenTicket(customerId) {
      const snap = await db.collection('tasks').where('customerId', '==', customerId).select('status').get();
      return snap.docs.some(d => (d.data() as any).status !== 'Concluída');
    },

    async countSentOnDay(dayKey) {
      const agg = await surveys.where('dayKey', '==', dayKey).where('status', '==', 'sent').count().get();
      return agg.data().count;
    },

    async createSurvey(record) {
      try {
        const { id, ...data } = record;
        await surveys.doc(id).create(data);
        return true;
      } catch (err: any) {
        if (err?.code === 6 || /already exists/i.test(String(err?.message))) return false;
        throw err;
      }
    },

    async updateSurvey(id, patch) {
      const { id: _ignored, ...data } = patch as any;
      await surveys.doc(id).set(data, { merge: true });
    },

    async setContact(customerId, patch) {
      await db.collection(SURVEY_CONTACTS_COL).doc(customerId).set({ ...patch, updatedAt: new Date().toISOString() }, { merge: true });
    },

    async addPhoneOptOut(phone, customerId) {
      await db.collection(SURVEY_OPTOUTS_COL).doc(phone).set({
        phone, customerId: customerId || '', createdAt: new Date().toISOString(), origin: 'WhatsApp'
      }, { merge: true });
    },

    async findSurveyByMessageId(messageId) {
      if (!messageId) return null;
      const snap = await surveys.where('waMessageId', '==', messageId).limit(1).get();
      return snap.empty ? null : toRecord(snap.docs[0]);
    },

    async findLatestSentSurveyByPhone(phone) {
      const snap = await surveys.where('phone', '==', phone).get();
      const sent = snap.docs.map(toRecord).filter(r => r.status === 'sent' && r.sentAt);
      sent.sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)));
      return sent[0] || null;
    },

    async acquireLock(ttlMs) {
      const ref = db.doc(LOCK_DOC);
      return db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const until = snap.exists ? Number((snap.data() as any).until || 0) : 0;
        if (until > Date.now() && (snap.data() as any).owner !== lockOwner) return false;
        tx.set(ref, { owner: lockOwner, until: Date.now() + ttlMs });
        return true;
      });
    },

    async releaseLock() {
      const ref = db.doc(LOCK_DOC);
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (snap.exists && (snap.data() as any).owner === lockOwner) tx.delete(ref);
      });
    }
  };
}

// ---------------------------------------------------------------
// WhatsApp Cloud API (Meta)
// ---------------------------------------------------------------

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
}

export function readWhatsAppConfig(env = process.env): WhatsAppConfig | null {
  const token = (env.WHATSAPP_TOKEN || '').trim();
  const phoneNumberId = (env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!token || !phoneNumberId) return null;
  return { token, phoneNumberId, apiVersion: (env.WHATSAPP_API_VERSION || 'v21.0').trim() };
}

export function createWhatsAppSender(config: WhatsAppConfig | null, fetchImpl: typeof fetch = fetch): SurveySender {
  const post = async (body: unknown): Promise<SendResult> => {
    if (!config) return { ok: false, error: 'WhatsApp não configurado.' };
    try {
      const res = await fetchImpl(`https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({})) as any;
      if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
      return { ok: true, messageId: data?.messages?.[0]?.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
  return {
    live: !!config,
    sendTemplate: message => post(message),
    sendText: (to, text) => post({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: false } })
  };
}

/** Confere a assinatura X-Hub-Signature-256 que a Meta manda no webhook. */
export function isValidMetaSignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Extrai mensagens e status do corpo do webhook da Meta. */
export function parseWebhookBody(body: any): {
  messages: Array<{ from: string; contextId?: string; payload?: string; text?: string }>;
  statuses: Array<{ id: string; status: string; error?: string }>;
} {
  const messages: Array<{ from: string; contextId?: string; payload?: string; text?: string }> = [];
  const statuses: Array<{ id: string; status: string; error?: string }> = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value || {};
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (!m?.from) continue;
        messages.push({
          from: String(m.from),
          contextId: m.context?.id,
          payload: m.button?.payload || m.interactive?.button_reply?.id,
          text: m.text?.body || m.button?.text || m.interactive?.button_reply?.title
        });
      }
      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        if (s?.id && s?.status) statuses.push({ id: String(s.id), status: String(s.status), error: s.errors?.[0]?.title });
      }
    }
  }
  return { messages, statuses };
}
