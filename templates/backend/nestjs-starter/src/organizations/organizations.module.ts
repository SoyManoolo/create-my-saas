import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Invitation } from './invitation.entity';
import { Membership } from './membership.entity';
import { Organization } from './organization.entity';
import { OrganizationRoleGuard } from './organization-role.guard';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { AuditLog } from '../audit/audit-log.entity';
import { AuditLogController } from '../audit/audit-log.controller';
import { AuditLogService } from '../audit/audit-log.service';
@Module({ imports: [AuthModule, TypeOrmModule.forFeature([Organization, Membership, Invitation, AuditLog])], controllers: [OrganizationsController, AuditLogController], providers: [OrganizationsService, OrganizationRoleGuard, AuditLogService], exports: [OrganizationsService, OrganizationRoleGuard, AuditLogService, TypeOrmModule] })
export class OrganizationsModule {}
