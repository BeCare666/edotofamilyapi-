import { IsArray, IsIn, IsString, Length } from 'class-validator';
import { CHAT_LANGS, ChatLang } from './ai-chat.constants';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

// Le détail de `messages` (rôles, longueurs, alternance) est vérifié par AiChatService.normalize.
export class AiChatDto {
  @IsString()
  @Length(8, 64)
  sessionId: string;

  @IsIn(CHAT_LANGS as unknown as string[])
  lang: ChatLang;

  @IsArray()
  messages: ChatTurn[];
}
