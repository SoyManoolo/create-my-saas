import { AppError } from '../common/errors/app.error';
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
});
