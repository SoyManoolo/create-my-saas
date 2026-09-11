import { Body, Controller, Delete, Get, Patch, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserPublicDto } from './dto/user-public.dto';
import { User } from './user.entity';
import { UsersService } from './users.service';

class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(255) name?: string;
  @IsOptional() @IsUrl() @MaxLength(2048) avatarUrl?: string | null;
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: User): UserPublicDto {
    return UserPublicDto.fromEntity(user);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(@CurrentUser() user: User, @Body() body: UpdateProfileDto): Promise<UserPublicDto> {
    return UserPublicDto.fromEntity(await this.usersService.updateProfile(user, {
      name: body.name,
      avatarUrl: body.avatarUrl,
    }));
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  async deactivateMe(@CurrentUser() user: User): Promise<void> {
    await this.usersService.deactivate(user);
  }
}
