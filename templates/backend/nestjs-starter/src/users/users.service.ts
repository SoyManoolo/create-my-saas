import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppError } from '../common/errors/app.error';
import { User } from './user.entity';
import { Membership } from '../organizations/membership.entity';
import { Organization } from '../organizations/organization.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async findByEmail(email: string, includePassword = false): Promise<User | null> {
    const query = this.users
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email });

    if (includePassword) {
      query.addSelect('user.passwordHash');
    }
    return query.getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  async findActiveById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found.', 404);
    }
    if (!user.isActive) {
      throw new AppError('USER_INACTIVE', 'The user account is inactive.', 403);
    }
    return user;
  }

  create(values: Pick<User, 'email' | 'name' | 'passwordHash'>): Promise<User> {
    return this.users.save(this.users.create(values));
  }

  async updateProfile(user: User, values: Partial<Pick<User, 'name' | 'avatarUrl'>>): Promise<User> {
    if (values.name !== undefined) user.name = values.name;
    if (values.avatarUrl !== undefined) user.avatarUrl = values.avatarUrl;
    return this.users.save(user);
  }

  async updatePassword(user: User, passwordHash: string): Promise<void> {
    await this.users.update(user.id, { passwordHash });
  }

  async deactivate(user: User): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const userQuery = manager.getRepository(User).createQueryBuilder('user').where('user.id = :userId', { userId: user.id });
      if (this.dataSource.options.type !== 'sqljs') userQuery.setLock('pessimistic_write');
      const lockedUser = await userQuery.getOne();
      if (!lockedUser?.isActive) throw new AppError('USER_INACTIVE', 'The user account is inactive.', 403);

      const membershipQuery = manager.getRepository(Membership).createQueryBuilder('membership')
        .where('membership.user_id = :userId AND membership.role = :role', { userId: user.id, role: 'owner' });
      const ownedMemberships = await membershipQuery.getMany();
      const organizationIds = [...new Set(ownedMemberships.map((membership) => membership.organizationId))].sort();
      if (organizationIds.length) {
        const organizationsQuery = manager.getRepository(Organization).createQueryBuilder('organization')
          .where('organization.id IN (:...organizationIds)', { organizationIds })
          .orderBy('organization.id', 'ASC');
        if (this.dataSource.options.type !== 'sqljs') organizationsQuery.setLock('pessimistic_write');
        await organizationsQuery.getMany();
      }
      for (const membership of ownedMemberships) {
        const activeOwners = manager.getRepository(Membership).createQueryBuilder('membership')
          .innerJoin(User, 'owner', 'owner.id = membership.user_id')
          .where('membership.organization_id = :organizationId AND membership.role = :role AND owner.is_active = true', { organizationId: membership.organizationId, role: 'owner' });
        if (await activeOwners.getCount() <= 1) {
          throw new AppError('LAST_ACTIVE_OWNER', 'Transfer ownership to another active user before deactivating this account.', 409);
        }
      }
      await manager.getRepository(User).update(lockedUser.id, { isActive: false, deactivatedAt: new Date() });
    });
  }

  save(user: User): Promise<User> { return this.users.save(user); }
}
