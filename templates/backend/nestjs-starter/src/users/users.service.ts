import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppError } from '../common/errors/app.error';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

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
    await this.users.update(user.id, { isActive: false, deactivatedAt: new Date() });
  }

  save(user: User): Promise<User> { return this.users.save(user); }
}
