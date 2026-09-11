import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Invitation } from './invitation.entity';
import { Membership } from './membership.entity';
import { Organization } from './organization.entity';
import { OrganizationRoleGuard } from './organization-role.guard';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
@Module({ imports: [AuthModule, TypeOrmModule.forFeature([Organization, Membership, Invitation])], controllers: [OrganizationsController], providers: [OrganizationsService, OrganizationRoleGuard], exports: [OrganizationsService, OrganizationRoleGuard, TypeOrmModule] })
export class OrganizationsModule {}
