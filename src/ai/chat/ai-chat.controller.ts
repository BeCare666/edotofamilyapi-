import { Body, Controller, HttpException, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { AiChatDto } from './ai-chat.dto';
import { AiChatService } from './ai-chat.service';
import { clientIp, consumeRateLimit } from './ai-chat.rate-limit';

// POST /api/ai/chat — ouvert à tous (sans connexion), réponse en flux SSE.
@Controller('ai')
export class AiChatController {
  constructor(private readonly aiChatService: AiChatService) {}

  @Post('chat')
  async chat(@Body() dto: AiChatDto, @Req() req: any, @Res() res: any) {
    const turns = this.aiChatService.normalize(dto);
    if (!consumeRateLimit(clientIp(req))) {
      throw new HttpException(
        'Tu as envoyé beaucoup de messages. Réessaie dans quelques minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abort = new AbortController();
    res.on('close', () => abort.abort());

    const emit = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    await this.aiChatService.run(dto, turns, emit, abort.signal);
    if (!res.writableEnded) res.end();
  }
}
