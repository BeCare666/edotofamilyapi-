import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { DatabaseService } from '../../database/database.services';
import { CampaignsService } from '../../campaigns/campaigns.service';
import {
  AI_CHAT_EFFORT,
  AI_CHAT_MODEL,
  AI_CHAT_PROVIDER,
  ALLOWED_WEB_DOMAINS,
  CALENDLY_URL,
  ChatLang,
  GROQ_API_URL,
  GROQ_MAX_RETRY_WAIT_S,
  GROQ_MODEL,
  GROQ_TIMEOUT_MS,
  GROQ_VERIFIER_MODEL,
  MAX_ASSISTANT_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_QUESTION_CHARS,
  MAX_TOOL_ROUNDS,
} from './ai-chat.constants';
import { AiChatDto, ChatTurn } from './ai-chat.dto';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_WITH_WEB_SEARCH, languageInstruction } from './ai-chat.prompt';
import { EmergencyKind, QUOTA_MESSAGE, REFER_MESSAGE, detectEmergency, emergencyPayload } from './ai-chat.safety';
import { CatalogProduct, EMERGENCY_KINDS, EdotoData, TOOL_DEFS, ToolOutput } from './ai-chat.tools';
import {
  CheckResult,
  VERIFIER_SYSTEM,
  deterministicChecks,
  mentionsExpert,
  parseVerdict,
  polishAnswer,
  productsMentioned,
  verifierUserMessage,
} from './ai-chat.guard';

// Événements SSE envoyés au front : meta, text, action, sources, done, error.
// La réponse n'est plus diffusée mot à mot : elle est contrôlée (ai-chat.guard.ts) puis envoyée d'un bloc.
export type Emit = (event: string, data: unknown) => void;

type ChatStatus = 'answered' | 'referred' | 'emergency' | 'refused' | 'blocked' | 'quota' | 'error';

const SERVICES_CONFIRMES = [
  'Rendez-vous confidentiel avec un conseiller SSR E.doto family (prise de rendez-vous en ligne)',
  'Commande des produits du catalogue sur la plateforme E.doto family',
  'Commandes : livraison à domicile ou retrait en point de retrait',
];

const AI_CHAT_VERIFIER_MODEL = process.env.AI_CHAT_VERIFIER_MODEL || 'claude-haiku-4-5';

// Quota gratuit du jour (ou par minute trop long à attendre) épuisé chez le fournisseur.
class QuotaError extends Error {}

interface RunState {
  status: ChatStatus;
  sources: Map<string, string>;
  calendlyShown: boolean;
  emergencyShown: boolean;
  referRequested: boolean;
  toolsCalled: string[];
  facts: unknown[];
  products: CatalogProduct[];
  campaigns: unknown[];
  answer: string;
  guardReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  private client: Anthropic | null = null;
  private readonly data: EdotoData;

  constructor(
    private readonly databaseService: DatabaseService,
    campaignsService: CampaignsService,
  ) {
    this.data = new EdotoData(databaseService, campaignsService);
  }

  private getClient(): Anthropic {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY manquante');
    if (!this.client) this.client = new Anthropic();
    return this.client;
  }

  private get modelName(): string {
    return AI_CHAT_PROVIDER === 'groq' ? GROQ_MODEL : AI_CHAT_MODEL;
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
      referRequested: false,
      toolsCalled: [],
      // Services E.doto family confirmés par le code et la base (01/10/2026), connus sans appeler d'outil.
      facts: [{ services_confirmes: SERVICES_CONFIRMES }],
      products: [],
      campaigns: [],
      answer: '',
      guardReason: null,
      inputTokens: 0,
      outputTokens: 0,
    };

    if (lang === 'fon') emit('meta', { notice: 'fon_unavailable' });

    try {
      const emergency = detectEmergency(question);
      if (emergency) {
        // Message fixe validé par l'équipe : aucune génération libre.
        this.showEmergency(emergency, lang, emit, state);
      } else {
        const draft =
          AI_CHAT_PROVIDER === 'groq'
            ? await this.generateGroq(turns, lang, emit, signal, state)
            : await this.generateClaude(turns, lang, emit, signal, state);
        if (draft !== null) await this.deliver(question, draft, lang, emit, signal, state);
      }
      if (state.sources.size && state.status !== 'blocked') {
        emit('sources', { items: [...state.sources].map(([url, title]) => ({ url, title })) });
      }
      emit('done', { status: state.status });
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof QuotaError) {
        // Limite gratuite atteinte : message clair + rendez-vous, pas de « Réessaie ».
        state.status = 'quota';
        state.answer = QUOTA_MESSAGE[lang === 'en' ? 'en' : 'fr'];
        emit('text', { delta: state.answer });
        this.showCalendly(emit, state);
        emit('done', { status: state.status });
      } else {
        state.status = 'error';
        this.logger.error(`Chat IA : ${err instanceof Error ? err.message : String(err)}`);
        emit('error', { message: 'Le service est momentanément indisponible. Réessaie dans un instant.' });
      }
    } finally {
      await this.log(dto, question, state);
    }
  }

  // ── Contrôle puis envoi de la réponse ─────────────────────────────────────────────────────────

  private async deliver(question: string, draft: string, lang: ChatLang, emit: Emit, signal: AbortSignal, state: RunState) {
    const refer = REFER_MESSAGE[lang === 'en' ? 'en' : 'fr'];
    let answer = draft.trim();

    // Après une alerte d'urgence, le message validé suffit si le modèle n'a rien ajouté.
    if (!answer && state.emergencyShown) return;
    if (!answer) {
      answer = refer;
      state.referRequested = true;
    }

    const verdict = this.isStandardRefusal(answer) ? { ok: true, violations: [] } : await this.check(question, answer, signal, state);
    if (!verdict.ok) {
      this.logger.warn(`Réponse bloquée : ${verdict.violations.join(' | ')} — texte : ${answer.slice(0, 300)}`);
      state.status = 'blocked';
      state.guardReason = verdict.violations.join(' | ').slice(0, 1000);
      state.answer = `[BLOQUÉE] ${answer}`;
      answer = refer;
      state.referRequested = true;
      state.products = [];
      state.campaigns = [];
    } else {
      answer = polishAnswer(answer);
      state.answer = answer;
    }

    emit('text', { delta: answer });

    if (state.status !== 'blocked') {
      const cited = productsMentioned(answer, state.products);
      if (cited.length) emit('action', { type: 'products', items: cited });
      if (state.campaigns.length) emit('action', { type: 'campaigns', items: state.campaigns });
    }
    // Toute mention d'un conseiller ou d'un rendez-vous s'accompagne de la vraie carte de rendez-vous.
    if (state.referRequested || mentionsExpert(answer)) this.showCalendly(emit, state);
    if (state.referRequested && state.status === 'answered') state.status = 'referred';
  }

  private isStandardRefusal(answer: string): boolean {
    return (
      answer.length < 220 &&
      /^(je ne connais pas la réponse avec certitude|je n'ai pas cette information|i don't know the answer with certainty|i don't have this information)/i.test(
        answer.replace(/[’]/g, "'"),
      )
    );
  }

  // 1) contrôles déterministes, 2) vérificateur IA. Tout échec ou doute = rejet (fail-closed).
  private async check(question: string, answer: string, signal: AbortSignal, state: RunState): Promise<CheckResult> {
    const local = deterministicChecks(answer, state.facts);
    if (!local.ok) return local;
    try {
      const raw =
        AI_CHAT_PROVIDER === 'groq'
          ? await this.verifyGroq(question, answer, signal, state)
          : await this.verifyClaude(question, answer, state);
      return parseVerdict(raw);
    } catch (err) {
      if (err instanceof QuotaError) throw err;
      if (signal.aborted) throw err;
      return { ok: false, violations: [`vérificateur indisponible : ${err instanceof Error ? err.message : String(err)}`] };
    }
  }

  private async verifyGroq(question: string, answer: string, signal: AbortSignal, state: RunState): Promise<string> {
    const res = await this.groqChat(
      {
        model: GROQ_VERIFIER_MODEL,
        messages: [
          { role: 'system', content: VERIFIER_SYSTEM },
          { role: 'user', content: verifierUserMessage(question, answer, state.facts, state.toolsCalled) },
        ],
        temperature: 0,
        max_completion_tokens: 1500,
        reasoning_effort: 'medium',
        response_format: { type: 'json_object' },
      },
      signal,
    );
    state.inputTokens += res.usage?.prompt_tokens || 0;
    state.outputTokens += res.usage?.completion_tokens || 0;
    return res.choices?.[0]?.message?.content || '';
  }

  private async verifyClaude(question: string, answer: string, state: RunState): Promise<string> {
    const message: any = await this.getClient().messages.create({
      model: AI_CHAT_VERIFIER_MODEL,
      max_tokens: 1000,
      system: VERIFIER_SYSTEM,
      messages: [{ role: 'user', content: verifierUserMessage(question, answer, state.facts, state.toolsCalled) }],
    } as any);
    state.inputTokens += message.usage?.input_tokens || 0;
    state.outputTokens += message.usage?.output_tokens || 0;
    return (message.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
  }

  // ── Génération : Groq (API compatible OpenAI) ─────────────────────────────────────────────────

  private async generateGroq(
    turns: ChatTurn[],
    lang: ChatLang,
    emit: Emit,
    signal: AbortSignal,
    state: RunState,
  ): Promise<string | null> {
    const tools = TOOL_DEFS.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
    const messages: any[] = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n${languageInstruction(lang)}` },
      ...turns.map((t) => ({ role: t.role, content: t.content })),
    ];
    let text = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let res: any;
      try {
        res = await this.groqChat(
          {
            model: GROQ_MODEL,
            messages,
            tools,
            tool_choice: 'auto',
            temperature: 0.2,
            max_completion_tokens: 2000,
            reasoning_effort: AI_CHAT_EFFORT,
          },
          signal,
        );
      } catch (err: any) {
        // Le modèle a tenté un outil inexistant : on ne devine pas, on oriente vers un conseiller.
        if (err?.code === 'tool_use_failed') {
          this.logger.warn(`Groq : appel d'outil invalide (${err.message})`);
          return '';
        }
        throw err;
      }
      state.inputTokens += res.usage?.prompt_tokens || 0;
      state.outputTokens += res.usage?.completion_tokens || 0;

      const choice = res.choices?.[0];
      const msg = choice?.message || {};
      if (msg.content) text = msg.content;
      if (choice?.finish_reason === 'length') return ''; // réponse tronquée : jamais affichée
      if (!msg.tool_calls?.length) return text;

      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        let input: any = {};
        try {
          input = JSON.parse(call.function?.arguments || '{}');
        } catch {
          input = null;
        }
        const out = input
          ? await this.executeTool(call.function?.name, input, lang, emit, state)
          : { content: 'Paramètres invalides.', is_error: true };
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.content });
      }
    }
    return ''; // trop d'allers-retours : on oriente vers un conseiller plutôt que de deviner
  }

  private async groqChat(body: Record<string, unknown>, signal: AbortSignal): Promise<any> {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY manquante');
    for (let attempt = 0; attempt < 3; attempt++) {
      // Annulation si le visiteur ferme le chat, ou délai dépassé.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), GROQ_TIMEOUT_MS);
      const onAbort = () => ctrl.abort();
      signal.addEventListener('abort', onAbort);
      let res: Response;
      try {
        res = await fetch(GROQ_API_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
      const json: any = await res.json().catch(() => ({}));
      if (res.ok) return json;

      const message = String(json?.error?.message || `HTTP ${res.status}`);
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after')) || 0;
        const daily = /per day|\(TPD\)|\(RPD\)/i.test(message);
        if (!daily && wait > 0 && wait <= GROQ_MAX_RETRY_WAIT_S && attempt < 2) {
          await new Promise((r) => setTimeout(r, (wait + 0.5) * 1000));
          continue;
        }
        throw new QuotaError(message);
      }
      const err: any = new Error(`Groq ${res.status} : ${message}`);
      err.code = json?.error?.code;
      throw err;
    }
    throw new QuotaError('Groq : limite par minute atteinte');
  }

  // ── Génération : Claude (Anthropic) ───────────────────────────────────────────────────────────

  private async generateClaude(
    turns: ChatTurn[],
    lang: ChatLang,
    emit: Emit,
    signal: AbortSignal,
    state: RunState,
  ): Promise<string | null> {
    const client = this.getClient();
    const tools: any[] = [
      { type: 'web_search_20260209', name: 'web_search', max_uses: 3, allowed_domains: ALLOWED_WEB_DOMAINS },
      ...TOOL_DEFS.map((t) => ({ ...t, eager_input_streaming: true })),
    ];
    const messages: any[] = turns.map((t) => ({ role: t.role, content: t.content }));
    let text = '';

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = client.beta.messages.stream(
        {
          model: AI_CHAT_MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: AI_CHAT_EFFORT },
          system: [
            { type: 'text', text: SYSTEM_PROMPT_WITH_WEB_SEARCH, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: languageInstruction(lang) },
          ],
          tools,
          messages,
        } as any,
        { signal },
      );
      const message: any = await stream.finalMessage();
      state.inputTokens += message.usage?.input_tokens || 0;
      state.outputTokens += message.usage?.output_tokens || 0;
      this.collectSources(message, state);

      if (message.stop_reason === 'refusal') {
        state.status = 'refused';
        state.answer = REFER_MESSAGE[lang === 'en' ? 'en' : 'fr'];
        emit('text', { delta: state.answer });
        state.referRequested = true;
        this.showCalendly(emit, state);
        return null;
      }
      // Si un modèle a décliné en cours de réponse, seul le texte du modèle de secours compte.
      const blocks: any[] = message.content || [];
      const lastFallback = blocks.map((b) => b.type).lastIndexOf('fallback');
      const roundText = blocks
        .slice(lastFallback + 1)
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (roundText.trim()) text = roundText;

      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      if (message.stop_reason === 'max_tokens') return ''; // réponse tronquée : jamais affichée
      const toolUses = blocks.filter((b) => b.type === 'tool_use');
      if (!toolUses.length) return text;

      messages.push({ role: 'assistant', content: message.content });
      const results = [];
      for (const t of toolUses) {
        const out = await this.executeTool(t.name, t.input, lang, emit, state);
        results.push({ type: 'tool_result', tool_use_id: t.id, content: out.content, ...(out.is_error ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
    }
    return '';
  }

  // ── Outils ────────────────────────────────────────────────────────────────────────────────────

  private async executeTool(
    name: string,
    input: any,
    lang: ChatLang,
    emit: Emit,
    state: RunState,
  ): Promise<{ content: string; is_error?: boolean }> {
    state.toolsCalled.push(name);
    const keep = (out: ToolOutput) => {
      if (out.facts !== undefined) state.facts.push(out.facts);
      if (out.products) state.products = out.products;
      if (out.campaigns) state.campaigns = out.campaigns;
      return { content: out.content, ...(out.is_error ? { is_error: true } : {}) };
    };
    try {
      switch (name) {
        case 'get_catalog':
          return keep(await this.data.catalog());
        case 'get_free_kit_campaigns': {
          const city = typeof input?.city === 'string' ? input.city.trim().slice(0, 100) : '';
          return keep(await this.data.campaigns(city));
        }
        case 'get_delivery_info':
          return keep(await this.data.delivery());
        case 'get_pickup_points':
          return keep(await this.data.pickupPoints());
        case 'refer_to_ssr_expert':
          state.referRequested = true;
          return { content: 'La carte de rendez-vous avec un conseiller SSR sera affichée à l’utilisateur.' };
        case 'signal_emergency': {
          const kind = input?.kind as EmergencyKind;
          if (!EMERGENCY_KINDS.includes(kind)) return { content: 'Paramètres invalides.', is_error: true };
          this.showEmergency(kind, lang, emit, state);
          return {
            content:
              "Le message d'aide validé est affiché. Réponds en une ou deux phrases chaleureuses, sans analyse médicale.",
          };
        }
      }
      return { content: `Outil inconnu : ${name}`, is_error: true };
    } catch (err) {
      this.logger.warn(`Outil ${name} en échec : ${err instanceof Error ? err.message : String(err)}`);
      return { content: 'Service momentanément indisponible : ne donne aucune information sur ce point.', is_error: true };
    }
  }

  private showCalendly(emit: Emit, state: RunState) {
    if (!state.calendlyShown) emit('action', { type: 'calendly', url: CALENDLY_URL });
    state.calendlyShown = true;
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

  // Journal anonymisé : ni IP ni identifiant en clair (empreinte de la session uniquement).
  // Les réponses bloquées sont gardées (préfixe [BLOQUÉE]) pour relecture par les pros de santé.
  private async log(dto: AiChatDto, question: string, state: RunState) {
    try {
      await this.databaseService.getPool().query(
        `INSERT INTO ai_chat_logs (session_hash, lang, question, answer, status, guard_reason, sources, model, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createHash('sha256').update(dto.sessionId).digest('hex'),
          dto.lang,
          question,
          state.answer.slice(0, 4000) || null,
          state.status,
          state.guardReason,
          JSON.stringify([...state.sources.keys()]),
          this.modelName,
          state.inputTokens,
          state.outputTokens,
        ],
      );
    } catch (err) {
      this.logger.warn(`Journal du chat IA non enregistré : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
