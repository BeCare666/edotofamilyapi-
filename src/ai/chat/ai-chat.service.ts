import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { DatabaseService } from '../../database/database.services';
import { CampaignsService } from '../../campaigns/campaigns.service';
import {
  AI_CHAT_EFFORT,
  AI_CHAT_MODEL,
  ALLOWED_WEB_DOMAINS,
  CALENDLY_URL,
  ChatLang,
  MAX_ASSISTANT_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_QUESTION_CHARS,
  MAX_TOOL_ROUNDS,
} from './ai-chat.constants';
import { AiChatDto, ChatTurn } from './ai-chat.dto';
import { SYSTEM_PROMPT, languageInstruction } from './ai-chat.prompt';
import { EmergencyKind, REFER_MESSAGE, detectEmergency, emergencyPayload } from './ai-chat.safety';

// Événements SSE envoyés au front : meta, text, reset, action, sources, done, error.
export type Emit = (event: string, data: unknown) => void;

type ChatStatus = 'answered' | 'referred' | 'emergency' | 'refused' | 'error';

const EMERGENCY_KINDS: EmergencyKind[] = ['suicide', 'violence', 'medical'];

const TOOLS: any[] = [
  {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: 3,
    allowed_domains: ALLOWED_WEB_DOMAINS,
  },
  {
    name: 'refer_to_ssr_expert',
    description:
      "Affiche à l'utilisateur une carte pour prendre un rendez-vous confidentiel avec un conseiller SSR d'Edotofamily. À utiliser dès que tu n'es pas certain de la réponse, si la personne demande à parler à quelqu'un, ou si sa situation mérite un accompagnement personnel.",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Raison courte (usage interne).' } },
      required: ['reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'signal_emergency',
    description:
      "Affiche un message d'aide validé par l'équipe quand la personne évoque des idées suicidaires (suicide), une violence subie (violence) ou un symptôme pouvant être une urgence médicale (medical).",
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: EMERGENCY_KINDS } },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_products',
    description:
      'Cherche des produits SSR publiés sur la boutique Edotofamily (préservatifs, protections hygiéniques, tests, etc.). Renvoie au plus 5 produits ; ils sont affichés en cartes à l’utilisateur.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Mot-clé court, ex. « préservatif ».' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_free_kit_campaigns',
    description:
      'Liste les campagnes de distribution de kits SSR gratuits en cours, éventuellement dans une ville. Elles sont affichées en cartes à l’utilisateur.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { city: { type: 'string', description: 'Ville (optionnel).' } },
      additionalProperties: false,
    },
  },
];

interface RunState {
  status: ChatStatus;
  sources: Map<string, string>;
  calendlyShown: boolean;
  emergencyShown: boolean;
  inputTokens: number;
  outputTokens: number;
}

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  private client: Anthropic | null = null;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly campaignsService: CampaignsService,
  ) {}

  // Sans clé, les messages d'urgence (réponses fixes) restent servis ; le reste renvoie une erreur.
  private getClient(): Anthropic {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY manquante');
    if (!this.client) this.client = new Anthropic();
    return this.client;
  }

  // Historique renvoyé par le client : on ne garde que du texte, alterné, borné en taille,
  // et terminé par la question de l'utilisateur.
  normalize(dto: AiChatDto): ChatTurn[] {
    const raw = Array.isArray(dto.messages) ? dto.messages.slice(-MAX_HISTORY_MESSAGES) : [];
    const turns: ChatTurn[] = [];
    for (const m of raw) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
        throw new BadRequestException('Message invalide.');
      }
      const content = m.content.trim();
      if (!content) continue;
      if (m.role === 'user' && content.length > MAX_QUESTION_CHARS) {
        throw new BadRequestException(`Question limitée à ${MAX_QUESTION_CHARS} caractères.`);
      }
      const text = m.role === 'assistant' ? content.slice(0, MAX_ASSISTANT_CHARS) : content;
      const last = turns[turns.length - 1];
      if (last && last.role === m.role) last.content += `\n\n${text}`;
      else turns.push({ role: m.role, content: text });
    }
    while (turns.length && turns[0].role !== 'user') turns.shift();
    if (!turns.length || turns[turns.length - 1].role !== 'user') {
      throw new BadRequestException('La conversation doit se terminer par une question.');
    }
    return turns;
  }

  async run(dto: AiChatDto, turns: ChatTurn[], emit: Emit, signal: AbortSignal): Promise<void> {
    const lang: ChatLang = dto.lang;
    const question = turns[turns.length - 1].content;
    const state: RunState = {
      status: 'answered',
      sources: new Map(),
      calendlyShown: false,
      emergencyShown: false,
      inputTokens: 0,
      outputTokens: 0,
    };

    if (lang === 'fon') emit('meta', { notice: 'fon_unavailable' });

    try {
      const emergency = detectEmergency(question);
      if (emergency) {
        this.showEmergency(emergency, lang, emit, state);
      } else {
        await this.converse(turns, lang, emit, signal, state);
      }
      if (state.sources.size) {
        emit('sources', { items: [...state.sources].map(([url, title]) => ({ url, title })) });
      }
      emit('done', { status: state.status });
    } catch (err) {
      if (signal.aborted) return;
      state.status = 'error';
      this.logger.error(`Chat IA : ${err instanceof Error ? err.message : String(err)}`);
      emit('error', { message: 'Le service est momentanément indisponible. Réessaie dans un instant.' });
    } finally {
      await this.log(dto, question, state);
    }
  }

  private async converse(
    turns: ChatTurn[],
    lang: ChatLang,
    emit: Emit,
    signal: AbortSignal,
    state: RunState,
  ): Promise<void> {
    const client = this.getClient();
    const messages: any[] = turns.map((t) => ({ role: t.role, content: t.content }));

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = client.beta.messages.stream(
        {
          model: AI_CHAT_MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: AI_CHAT_EFFORT },
          system: [
            { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: languageInstruction(lang) },
          ],
          tools: TOOLS,
          messages,
        } as any,
        { signal },
      );

      for await (const event of stream as AsyncIterable<any>) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          emit('text', { delta: event.delta.text });
        } else if (event.type === 'content_block_start' && event.content_block?.type === 'fallback') {
          // Un modèle a décliné en cours de réponse : le texte partiel est remplacé par celui du modèle de secours.
          emit('reset', {});
        }
      }
      const message: any = await stream.finalMessage();
      state.inputTokens += message.usage?.input_tokens || 0;
      state.outputTokens += message.usage?.output_tokens || 0;
      this.collectSources(message, state);

      if (message.stop_reason === 'refusal') {
        emit('reset', {});
        this.refer(lang, emit, state, true);
        state.status = 'refused';
        return;
      }
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      const toolUses = message.content.filter((b: any) => b.type === 'tool_use');
      if (!toolUses.length || message.stop_reason === 'max_tokens') return;

      messages.push({ role: 'assistant', content: message.content });
      const results = await Promise.all(
        toolUses.map(async (t: any) => ({
          type: 'tool_result',
          tool_use_id: t.id,
          ...(await this.executeTool(t.name, t.input, lang, emit, state)),
        })),
      );
      messages.push({ role: 'user', content: results });
    }
  }

  private async executeTool(
    name: string,
    input: any,
    lang: ChatLang,
    emit: Emit,
    state: RunState,
  ): Promise<{ content: string; is_error?: boolean }> {
    const invalid = { content: 'Paramètres invalides.', is_error: true };
    try {
      switch (name) {
        case 'refer_to_ssr_expert':
          this.refer(lang, emit, state, false);
          return { content: 'La carte de rendez-vous avec un conseiller SSR est affichée à l’utilisateur.' };

        case 'signal_emergency': {
          const kind = input?.kind as EmergencyKind;
          if (!EMERGENCY_KINDS.includes(kind)) return invalid;
          this.showEmergency(kind, lang, emit, state);
          return {
            content:
              "Le message d'aide validé est affiché. Réponds en une ou deux phrases chaleureuses, sans analyse médicale.",
          };
        }

        case 'search_products': {
          const query = typeof input?.query === 'string' ? input.query.trim().slice(0, 100) : '';
          if (!query) return invalid;
          const items = await this.searchProducts(query);
          if (items.length) emit('action', { type: 'products', items });
          return {
            content: items.length
              ? JSON.stringify(items.map(({ name, price, sale_price }) => ({ name, price, sale_price })))
              : 'Aucun produit trouvé pour cette recherche.',
          };
        }

        case 'get_free_kit_campaigns': {
          const city = typeof input?.city === 'string' ? input.city.trim().slice(0, 100) : '';
          const items = await this.freeKitCampaigns(city);
          if (items.length) emit('action', { type: 'campaigns', items });
          return {
            content: items.length ? JSON.stringify(items) : 'Aucune campagne de kits gratuits en cours.',
          };
        }
      }
      return { content: `Outil inconnu : ${name}`, is_error: true };
    } catch (err) {
      this.logger.warn(`Outil ${name} en échec : ${err instanceof Error ? err.message : String(err)}`);
      return { content: 'Service momentanément indisponible.', is_error: true };
    }
  }

  private refer(lang: ChatLang, emit: Emit, state: RunState, withMessage: boolean) {
    if (withMessage) emit('text', { delta: REFER_MESSAGE[lang === 'en' ? 'en' : 'fr'] });
    if (!state.calendlyShown) emit('action', { type: 'calendly', url: CALENDLY_URL });
    state.calendlyShown = true;
    if (state.status === 'answered') state.status = 'referred';
  }

  private showEmergency(kind: EmergencyKind, lang: ChatLang, emit: Emit, state: RunState) {
    if (!state.emergencyShown) emit('action', { type: 'emergency', ...emergencyPayload(kind, lang) });
    state.emergencyShown = true;
    state.calendlyShown = true; // la carte d'urgence contient déjà le lien de rendez-vous
    state.status = 'emergency';
  }

  private collectSources(message: any, state: RunState) {
    for (const block of message.content || []) {
      for (const c of block.citations || []) {
        if (c?.url && !state.sources.has(c.url)) state.sources.set(c.url, c.title || c.url);
      }
    }
  }

  private async searchProducts(query: string) {
    const like = `%${query}%`;
    const [rows]: any[] = await this.databaseService.getPool().query(
      `SELECT name, slug, price, sale_price, image FROM products
       WHERE status = 'publish' AND deleted_at IS NULL AND (name LIKE ? OR description LIKE ?)
       ORDER BY (name LIKE ?) DESC, id DESC LIMIT 5`,
      [like, like, like],
    );
    return rows.map((r: any) => ({
      name: r.name,
      slug: r.slug,
      price: r.price != null ? Number(r.price) : null,
      sale_price: r.sale_price != null ? Number(r.sale_price) : null,
      image: imageUrl(r.image),
    }));
  }

  private async freeKitCampaigns(city: string) {
    const rows = (city
      ? await this.campaignsService.getActiveCampaignByCity(city)
      : await this.campaignsService.getActiveCampaign()) || [];
    return rows.slice(0, 5).map((c: any) => ({
      id: c.id,
      title: c.title,
      cities: c.cities,
      date_start: c.date_start,
      date_end: c.date_end,
    }));
  }

  // Journal anonymisé : ni IP ni identifiant en clair (empreinte de la session uniquement).
  private async log(dto: AiChatDto, question: string, state: RunState) {
    try {
      await this.databaseService.getPool().query(
        `INSERT INTO ai_chat_logs (session_hash, lang, question, status, sources, model, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createHash('sha256').update(dto.sessionId).digest('hex'),
          dto.lang,
          question,
          state.status,
          JSON.stringify([...state.sources.keys()]),
          AI_CHAT_MODEL,
          state.inputTokens,
          state.outputTokens,
        ],
      );
    } catch (err) {
      this.logger.warn(`Journal du chat IA non enregistré : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function imageUrl(raw: unknown): string | null {
  if (!raw) return null;
  let v: any = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return v;
    }
  }
  if (typeof v === 'string') return v;
  return v?.thumbnail || v?.original || null;
}
