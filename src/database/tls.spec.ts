import { X509Certificate } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TIDB_CA_PATH, tidbSsl } from './tls';

// Audit sécurité 2.4 (28/10/2026) : TLS vers TiDB toujours vérifié
describe('TLS TiDB (2.4)', () => {
  it('le fichier certs/tidb-ca.pem est un vrai certificat PEM : ISRG Root X1', () => {
    const cert = new X509Certificate(readFileSync(TIDB_CA_PATH));
    expect(cert.subject).toContain('CN=ISRG Root X1');
    expect(cert.fingerprint256).toBe(
      '96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6',
    );
  });

  it('vérifie le serveur, TLS 1.2 minimum, CA chargé', () => {
    const ssl: any = tidbSsl();
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.minVersion).toBe('TLSv1.2');
    expect(ssl.ca).toContain('-----BEGIN CERTIFICATE-----');
  });

  it('fichier absent : toujours vérifié (racines de Node), jamais relâché', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ssl: any = tidbSsl(join(__dirname, 'absent.pem'));
    expect(ssl).toEqual({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    warn.mockRestore();
  });
});
