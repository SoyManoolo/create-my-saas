import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User } from '../users/user.entity';
import type { Membership, OrganizationRole } from './membership.entity';
import { OrganizationRoleGuard } from './organization-role.guard';
import { OrganizationsService } from './organizations.service';
import { OrganizationRoles } from './roles.decorator';
class CreateOrganizationDto { @IsString() @MinLength(1) @MaxLength(255) name!: string; @IsOptional() @IsString() @MaxLength(100) slug?: string; }
class InviteDto { @IsEmail() @MaxLength(320) email!: string; @IsIn(['admin', 'member']) role!: 'admin' | 'member'; }
class AcceptInvitationDto { @IsString() @MinLength(20) token!: string; }
class ChangeRoleDto { @IsIn(['admin', 'member']) role!: OrganizationRole; }
class TransferOwnershipDto { @IsUUID() userId!: string; }
@Controller('organizations') @UseGuards(JwtAuthGuard)
export class OrganizationsController {
 constructor(private readonly organizations: OrganizationsService) {}
 @Post() create(@CurrentUser() user: User, @Body() body: CreateOrganizationDto) { return this.organizations.create(user, body.name, body.slug); }
 @Get() list(@CurrentUser() user: User) { return this.organizations.list(user.id); }
 @Get(':organizationId/members') @UseGuards(OrganizationRoleGuard) members(@Param('organizationId') id: string): Promise<Membership[]> { return this.organizations.members(id); }
 @Post(':organizationId/invitations') @UseGuards(OrganizationRoleGuard) @OrganizationRoles('owner', 'admin') @HttpCode(HttpStatus.NO_CONTENT)
 async invite(@CurrentUser() user: User, @Param('organizationId') id: string, @Body() body: InviteDto): Promise<void> { await this.organizations.invite(id, user.id, body.email, body.role); }
 @Post('invitations/accept') @HttpCode(HttpStatus.CREATED)
 accept(@CurrentUser() user: User, @Body() body: AcceptInvitationDto) { return this.organizations.acceptInvitation(user, body.token); }
 @Patch(':organizationId/members/:userId') @UseGuards(OrganizationRoleGuard) @OrganizationRoles('owner', 'admin') @HttpCode(HttpStatus.NO_CONTENT)
 async role(@CurrentUser() user: User, @Param('organizationId') id: string, @Param('userId') userId: string, @Body() body: ChangeRoleDto): Promise<void> { await this.organizations.changeRole(id, user.id, userId, body.role); }
 @Delete(':organizationId/members/:userId') @UseGuards(OrganizationRoleGuard) @OrganizationRoles('owner', 'admin') @HttpCode(HttpStatus.NO_CONTENT)
 async remove(@CurrentUser() user: User, @Param('organizationId') id: string, @Param('userId') userId: string): Promise<void> { await this.organizations.removeMember(id, user.id, userId); }
 @Post(':organizationId/ownership/transfer') @UseGuards(OrganizationRoleGuard) @OrganizationRoles('owner') @HttpCode(HttpStatus.NO_CONTENT)
 async transferOwnership(@CurrentUser() user: User, @Param('organizationId') id: string, @Body() body: TransferOwnershipDto): Promise<void> {
  await this.organizations.transferOwnership(id, user.id, body.userId);
 }
}
