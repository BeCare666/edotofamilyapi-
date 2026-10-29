import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { SousCategoriesModule } from './sous-categories/categories.module';
import { CommonModule } from './common/common.module';
import { FeedbackModule } from './feedbacks/feedbacks.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentIntentModule } from './payment-intent/payment-intent.module';
import { PaymentModule } from './payment/payment.module';
import { ProductsModule } from './products/products.module';
import { QuestionModule } from './questions/questions.module';
import { ReviewModule } from './reviews/reviews.module';
import { SettingsModule } from './settings/settings.module';
import { ShippingsModule } from './shippings/shippings.module';
import { ShopsModule } from './shops/shops.module';
import { TagsModule } from './tags/tags.module';
import { TaxesModule } from './taxes/taxes.module';
import { TypesModule } from './types/types.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';
import { WithdrawsModule } from './withdraws/withdraws.module';
import { AiModule } from './ai/ai.module';
import { DatabaseModule } from './database/database.module'
import { CountriesModule } from './countries/countries.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { PickupModule } from './pickup/pickup.module';
import { DeliveryModule } from './delivery/delivery.module';
import { CommissionsModule } from './commissions/commissions.module';
import { SponsorsModule } from './sponsors/sponsors.module';
import { TeleconsultationModule } from './teleconsultation/teleconsultation.module';
import { ContraceptionModule } from './contraception/contraception.module';
import { AdminNotificationsModule } from './admin-notifications/admin-notifications.module';
import { SiteAppearanceModule } from './site-appearance/site-appearance.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClientThrottlerGuard, MINUTE } from './common/client-throttler.guard';
import { GlobalJwtAuthGuard } from './auth/global-jwt-auth.guard';
import { StepUpGuard } from './auth/step-up';
import { AdminAuditInterceptor } from './common/admin-audit';
//import { DatabaseService } from './database/database.services'; 
@Module({
  imports: [
    ConfigModule.forRoot(),
    // Audit sécurité 1.2 : 100 requêtes par minute et par adresse IP du client, sur toute l'API
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', limit: 100, ttl: MINUTE }],
      errorMessage: 'Trop de requêtes. Réessayez dans un instant.',
    }),
    UsersModule,
    CommonModule,
    ProductsModule,
    OrdersModule,
    CategoriesModule,
    SousCategoriesModule,
    AnalyticsModule,
    ShippingsModule,
    TaxesModule,
    TagsModule,
    ShopsModule,
    TypesModule,
    WithdrawsModule,
    UploadsModule,
    SettingsModule,
    AuthModule,
    ReviewModule,
    QuestionModule,
    FeedbackModule,
    PaymentIntentModule,
    PaymentModule,
    AiModule,
    DatabaseModule,
    CountriesModule,
    CampaignsModule,
    PickupModule,
    DeliveryModule,
    CommissionsModule,
    SponsorsModule,
    TeleconsultationModule,
    ContraceptionModule,
    AdminNotificationsModule,
    SiteAppearanceModule
    //DatabaseService
  ],
  controllers: [],
  // Ordre voulu : la limitation de débit s'applique aussi aux requêtes refusées faute de jeton
  providers: [
    { provide: APP_GUARD, useClass: ClientThrottlerGuard },
    { provide: APP_GUARD, useClass: GlobalJwtAuthGuard },
    // Audit 3.1 : code de double authentification redemandé pour les actions sensibles (après la session)
    { provide: APP_GUARD, useClass: StepUpGuard },
    // Audit 3.3 : journal des actions faites depuis l'admin (qui, quoi, quand, IP)
    { provide: APP_INTERCEPTOR, useClass: AdminAuditInterceptor },
  ],
})
export class AppModule { }
