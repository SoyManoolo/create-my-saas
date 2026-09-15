import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuditLog } from './audit-log.entity';
import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  function setup(auditLogEnabled = true) {
    const logs = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'audit-1', createdAt: new Date(), ...value })),
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const config = { get: jest.fn((_name: string, fallback?: boolean) => auditLogEnabled ?? fallback) };
    return { service: new AuditLogService(logs as unknown as Repository<AuditLog>, config as unknown as ConfigService), logs };
  }

  it('persists only allowlisted scalar metadata', async () => {
    const { service, logs } = setup();
    await service.record({
      organizationId: 'organization-1', actorUserId: 'actor-1', action: 'billing.checkout.created',
      targetType: 'billing', metadata: { provider: 'stripe', plan: 'pro', quantity: 2 },
    });
    expect(logs.save).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'actor-1', metadata: { provider: 'stripe', plan: 'pro', quantity: 2 },
    }));
    await expect(service.record({
      organizationId: 'organization-1', actorUserId: 'actor-1', action: 'billing.portal.created',
      targetType: 'billing', metadata: { provider: 'stripe', sessionId: 'bps_secret' },
    })).rejects.toThrow('Audit metadata is not allowed');
    await expect(service.record({
      organizationId: 'organization-1', actorUserId: 'actor-1', action: 'billing.portal.created',
      targetType: 'billing', metadata: { provider: { apiKey: 'secret' } as never },
    })).rejects.toThrow('Audit metadata values must be scalar');
  });

  it('does not persist new events when audit logging is disabled', async () => {
    const { service, logs } = setup(false);
    await expect(service.record({
      organizationId: 'organization-1', actorUserId: 'actor-1', action: 'billing.portal.created',
      targetType: 'billing', metadata: { provider: 'stripe' },
    })).resolves.toBeNull();
    expect(logs.create).not.toHaveBeenCalled();
    expect(logs.save).not.toHaveBeenCalled();
  });
});
