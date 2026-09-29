import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiChatController } from './chat/ai-chat.controller';
import { AiChatService } from './chat/ai-chat.service';
import { DatabaseModule } from '../database/database.module';
import { CampaignsModule } from '../campaigns/campaigns.module';

@Module({
  imports: [DatabaseModule, CampaignsModule],
  controllers: [AiController, AiChatController],
  providers: [AiService, AiChatService],
})
export class AiModule {}
