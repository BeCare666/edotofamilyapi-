import { MAINTENANCE_MESSAGE, maintenanceGate, maintenanceOn } from './maintenance';

// Audit sécurité 3.7 (29/10/2026) : couper l'API pendant un incident
describe('Mode maintenance', () => {
  const ENV = process.env.MAINTENANCE_MODE;
  afterEach(() => {
    if (ENV === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = ENV;
  });
  const call = () => {
    const res: any = { headers: {}, setHeader: (k: string, v: string) => (res.headers[k] = v), status: jest.fn(() => res), json: jest.fn(() => res) };
    const next = jest.fn();
    maintenanceGate()({}, res, next);
    return { res, next };
  };

  it('seule la valeur « on » active la maintenance', () => {
    expect(maintenanceOn('on')).toBe(true);
    expect(maintenanceOn(' ON ')).toBe(true);
    expect(maintenanceOn('')).toBe(false);
    expect(maintenanceOn(undefined)).toBe(false);
    expect(maintenanceOn('true')).toBe(false);
  });

  it('désactivée : la requête continue', () => {
    delete process.env.MAINTENANCE_MODE;
    const { res, next } = call();
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('activée : 503 pour toute route, avec Retry-After et un message clair', () => {
    process.env.MAINTENANCE_MODE = 'on';
    const { res, next } = call();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 503, message: MAINTENANCE_MESSAGE });
    expect(res.headers['Retry-After']).toBe('600');
  });
});
