// Exécution manuelle des scripts SQL (création des tables et migrations) : `npm run db:setup`.
// Même liste et même connexion que DatabaseSetupService ; tous les scripts sont rejouables.
import * as dotenv from 'dotenv';
import { DatabaseSetupService } from './database-setup.service';

dotenv.config();

new DatabaseSetupService()
  .run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌ Échec des scripts SQL :', e?.message || e);
    process.exit(1);
  });
