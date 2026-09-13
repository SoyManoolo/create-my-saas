import { AppError } from '../common/errors/app.error';
import { randomUUID } from 'node:crypto';
import { SecureEmailService } from '../auth/secure-email.service';
import { User } from '../users/user.entity';
import { Invitation } from './invitation.entity';
import { Membership } from './membership.entity';
import { Organization } from './organization.entity';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  const user = { id: 'user-1', email: 'owner@example.com' } as User;

  function setup() {
    const organizations = { create: jest.fn((values) => values), save: jest.fn(async (values) => ({ id: 'organization-1', ...values })) };
    const memberships = { create: jest.fn((values) => values), save: jest.fn(async (values) => ({ id: 'membership-1', ...values })), findOneBy: jest.fn() };
    const invitations = { create: jest.fn((values) => values), save: jest.fn(async (values) => ({ id: 'invitation-1', ...values })), findOneBy: jest.fn(), update: jest.fn(), remove: jest.fn(), createQueryBuilder: jest.fn() };
    const repositories = new Map<unknown, any>([[Organization, organizations], [Membership, memberships], [Invitation, invitations]]);
    const dataSource = {
      options: { type: 'sqljs' },
      transaction: jest.fn(async (callback) => callback({ getRepository: (entity) => repositories.get(entity) })),
    };
    const secureEmail = { send: jest.fn() } as unknown as SecureEmailService;
    return { service: new OrganizationsService(organizations as never, memberships as never, invitations as never, dataSource as never, secureEmail), dataSource, organizations, memberships, invitations, secureEmail };
  }

  it('creates the organization and its owner membership in one transaction', async () => {
    const { service, dataSource, organizations, memberships } = setup();

    await expect(service.create(user, 'Acme, Inc.')).resolves.toMatchObject({ id: 'organization-1', slug: 'acme-inc' });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(organizations.save).toHaveBeenCalledWith({ name: 'Acme, Inc.', slug: 'acme-inc' });
    expect(memberships.save).toHaveBeenCalledWith({ organizationId: 'organization-1', userId: 'user-1', role: 'owner' });
  });

  it('validates and normalizes invitation email addresses before persisting them', async () => {
    const { service } = setup();

    await expect(service.invite('organization-1', 'not-an-email', 'member')).rejects.toEqual(
      new AppError('INVALID_INVITATION_EMAIL', 'A valid invitation email is required.', 400),
    );
  });

  it('does not create or send a second active invitation for the same recipient', async () => {
    const { service, invitations, secureEmail } = setup();
    let stored: Invitation | undefined;
    const query = { where: jest.fn().mockReturnThis(), getOne: jest.fn(async () => stored) };
    invitations.createQueryBuilder.mockReturnValue(query);
    invitations.save.mockImplementation(async (values) => {
      stored = { id: 'invitation-1', ...values } as Invitation;
      return stored;
    });

    await service.invite('organization-1', 'Member@Example.com', 'member');
    await service.invite('organization-1', 'member@example.com', 'member');

    expect(invitations.save).toHaveBeenCalledTimes(1);
    expect(secureEmail.send).toHaveBeenCalledTimes(1);
    expect(secureEmail.send).toHaveBeenCalledWith('member@example.com', 'Organization invitation', expect.any(String));
  });

  it('treats a concurrent active-invitation constraint conflict as an idempotent retry', async () => {
    const { service, invitations, secureEmail } = setup();
    const activeInvitation = { id: 'invitation-1', organizationId: 'organization-1', email: 'member@example.com', acceptedAt: null, expiresAt: new Date(Date.now() + 60_000) } as Invitation;
    invitations.createQueryBuilder.mockReturnValue({ where: jest.fn().mockReturnThis(), getOne: jest.fn(async () => null) });
    invitations.save.mockRejectedValue({ code: '23505' });
    invitations.findOneBy.mockResolvedValue(activeInvitation);

    await expect(service.invite('organization-1', 'member@example.com', 'member')).resolves.toBeUndefined();

    expect(secureEmail.send).not.toHaveBeenCalled();
  });

  it('returns the established membership when an invitation acceptance is retried', async () => {
    const { service, invitations, memberships } = setup();
    const membership = { id: 'membership-1', organizationId: 'organization-1', userId: user.id, role: 'member' } as Membership;
    const invitation = { id: 'invitation-1', organizationId: 'organization-1', email: user.email, role: 'member', acceptedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } as Invitation;
    invitations.createQueryBuilder.mockReturnValue({ where: jest.fn().mockReturnThis(), getOne: jest.fn(async () => invitation) });
    memberships.findOneBy.mockResolvedValue(membership);

    await expect(service.acceptInvitation(user, 'known-token')).resolves.toBe(membership);

    expect(memberships.save).not.toHaveBeenCalled();
    expect(invitations.update).not.toHaveBeenCalled();
  });

  function ownershipSetup(options: { actorRole?: 'owner' | 'admin' | 'member'; targetActive?: boolean; targetIsMember?: boolean } = {}) {
    const organizationId = randomUUID();
    const actor = { id: randomUUID(), email: 'owner@example.com', isActive: true } as User;
    const target = { id: randomUUID(), email: 'target@example.com', isActive: options.targetActive ?? true } as User;
    const organization = { id: organizationId, name: 'Acme', slug: 'acme' } as Organization;
    const users = [actor, target];
    const storedMemberships = [
      { id: randomUUID(), organizationId, userId: actor.id, role: options.actorRole ?? 'owner' } as Membership,
      ...(options.targetIsMember === false ? [] : [
        { id: randomUUID(), organizationId, userId: target.id, role: 'member' } as Membership,
      ]),
    ];
    const lockAliases: string[] = [];

    const usersRepository = {
      createQueryBuilder: jest.fn((alias: string) => {
        const builder: any = {};
        let parameters: Record<string, any> = {};
        builder.where = jest.fn((_condition: string, values: Record<string, any>) => { parameters = values; return builder; });
        builder.orderBy = jest.fn(() => builder);
        builder.setLock = jest.fn(() => { lockAliases.push(alias); return builder; });
        builder.getMany = jest.fn(async () => users.filter((entry) => (parameters.userIds ?? [parameters.userId]).includes(entry.id)));
        return builder;
      }),
    };
    const organizationsRepository = {
      createQueryBuilder: jest.fn((alias: string) => {
        const builder: any = {};
        builder.where = jest.fn(() => builder);
        builder.setLock = jest.fn(() => { lockAliases.push(alias); return builder; });
        builder.getOne = jest.fn(async () => organization);
        return builder;
      }),
    };
    const membershipsRepository = {
      createQueryBuilder: jest.fn((alias: string) => {
        const builder: any = {};
        let parameters: Record<string, any> = {};
        builder.where = jest.fn((_condition: string, values: Record<string, any>) => { parameters = values; return builder; });
        builder.orderBy = jest.fn(() => builder);
        builder.setLock = jest.fn(() => { lockAliases.push(alias); return builder; });
        builder.getMany = jest.fn(async () => storedMemberships.filter((entry) =>
          entry.organizationId === parameters.organizationId && (parameters.userIds ?? [parameters.userId]).includes(entry.userId)));
        return builder;
      }),
      update: jest.fn(async (criteria: string | { id: string; role: string }, values: Partial<Membership>) => {
        const membership = storedMemberships.find((entry) =>
          typeof criteria === 'string' ? entry.id === criteria : entry.id === criteria.id && entry.role === criteria.role);
        if (membership && values.role) membership.role = values.role;
        return { affected: membership ? 1 : 0 };
      }),
      remove: jest.fn(async (membership: Membership) => {
        const index = storedMemberships.indexOf(membership);
        if (index >= 0) storedMemberships.splice(index, 1);
        return membership;
      }),
    };
    const repositories = new Map<unknown, any>([
      [User, usersRepository],
      [Organization, organizationsRepository],
      [Membership, membershipsRepository],
    ]);
    const manager = { getRepository: (entity: unknown) => repositories.get(entity) };
    let transactionTail = Promise.resolve();
    const dataSource = {
      options: { type: 'postgres' },
      transaction: jest.fn(<T>(callback: (value: typeof manager) => Promise<T>) => {
        const result = transactionTail.then(() => callback(manager));
        transactionTail = result.then(() => undefined, () => undefined);
        return result;
      }),
    };
    const service = new OrganizationsService(
      organizationsRepository as never,
      membershipsRepository as never,
      {} as never,
      dataSource as never,
      { send: jest.fn() } as never,
    );
    return { service, organizationId, actor, target, users, storedMemberships, lockAliases };
  }

  it('transfers ownership atomically and lets the previous owner leave', async () => {
    const state = ownershipSetup();

    await state.service.transferOwnership(state.organizationId, state.actor.id, state.target.id);

    expect(state.storedMemberships.find((membership) => membership.userId === state.target.id)?.role).toBe('owner');
    expect(state.storedMemberships.find((membership) => membership.userId === state.actor.id)?.role).toBe('admin');
    expect(state.storedMemberships.filter((membership) => membership.role === 'owner')).toHaveLength(1);
    expect(state.lockAliases).toEqual(['user', 'organization', 'membership']);

    await state.service.removeMember(state.organizationId, state.actor.id, state.actor.id);
    expect(state.storedMemberships.some((membership) => membership.userId === state.actor.id)).toBe(false);
    expect(state.storedMemberships.filter((membership) => membership.role === 'owner')).toHaveLength(1);
  });

  it.each(['admin', 'member'] as const)('rejects ownership transfer by a %s', async (actorRole) => {
    const state = ownershipSetup({ actorRole });

    await expect(state.service.transferOwnership(state.organizationId, state.actor.id, state.target.id)).rejects.toMatchObject({
      code: 'ORGANIZATION_ACCESS_DENIED',
      statusCode: 403,
    });
    expect(state.storedMemberships.find((membership) => membership.userId === state.actor.id)?.role).toBe(actorRole);
  });

  it('rejects inactive, external and nonexistent ownership targets', async () => {
    const inactive = ownershipSetup({ targetActive: false });
    const external = ownershipSetup({ targetIsMember: false });
    const missing = ownershipSetup();

    for (const [state, targetId] of [
      [inactive, inactive.target.id],
      [external, external.target.id],
      [missing, randomUUID()],
      [missing, missing.actor.id],
    ] as const) {
      await expect(state.service.transferOwnership(state.organizationId, state.actor.id, targetId)).rejects.toMatchObject({
        code: 'OWNERSHIP_TARGET_NOT_ELIGIBLE',
        statusCode: 409,
      });
      expect(state.storedMemberships.filter((membership) => membership.role === 'owner')).toHaveLength(1);
    }
  });

  it('serializes concurrent transfers so exactly one destination becomes owner', async () => {
    const state = ownershipSetup();
    const secondTarget = { id: randomUUID(), email: 'second@example.com', isActive: true } as User;
    state.users.push(secondTarget);
    state.storedMemberships.push({
      id: randomUUID(),
      organizationId: state.organizationId,
      userId: secondTarget.id,
      role: 'member',
    } as Membership);

    const results = await Promise.allSettled([
      state.service.transferOwnership(state.organizationId, state.actor.id, state.target.id),
      state.service.transferOwnership(state.organizationId, state.actor.id, secondTarget.id),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(state.storedMemberships.filter((membership) => membership.role === 'owner')).toHaveLength(1);
  });
});
