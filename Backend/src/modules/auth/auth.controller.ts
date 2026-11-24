import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthUser, CurrentUser, MANAGERS, Public, Roles } from '../../common/decorators';
import { AuthService } from './auth.service';
import {
  AssignRoleDto,
  ChangePasswordDto,
  CreateUserDto,
  ListUsersDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './dto/auth.dto';

const meta = (req: Request) => ({ userAgent: req.headers['user-agent'], ip: req.ip });

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, meta(req));
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request, @CurrentUser() actor?: AuthUser) {
    return this.auth.register(dto, meta(req), actor);
  }

  /** Demo credentials for the login page. Empty unless DEMO_MODE=true. */
  @Public()
  @Get('demo-accounts')
  demoAccounts() {
    return this.auth.demoAccounts();
  }

  @Public()
  @Post('refresh-token')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser() user: AuthUser, @Body() body: Partial<RefreshTokenDto>) {
    return this.auth.logout(user.id, body?.refreshToken);
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user.id);
  }

  @Put('profile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, dto);
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  // ───────── staff management ─────────

  @Get('roles')
  roles() {
    return this.auth.roleCatalog();
  }

  @Roles(...MANAGERS)
  @Get('users')
  users(@CurrentUser() actor: AuthUser, @Query() q: ListUsersDto) {
    return this.auth.listUsers(actor, q);
  }

  @Roles(...MANAGERS)
  @Post('users')
  createUser(@CurrentUser() actor: AuthUser, @Body() dto: CreateUserDto) {
    return this.auth.createUser(actor, dto);
  }

  @Roles(...MANAGERS)
  @Put('users/:id')
  updateUser(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.auth.updateUser(actor, id, dto);
  }

  @Roles(...MANAGERS)
  @Delete('users/:id')
  deleteUser(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.deactivateUser(actor, id);
  }

  @Roles(...MANAGERS)
  @Post('users/:id/roles')
  assignRole(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignRoleDto) {
    return this.auth.assignRole(actor, id, dto);
  }

  @Roles(...MANAGERS)
  @Delete('users/:id/roles/:roleId')
  removeRole(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.auth.removeRole(actor, id, roleId);
  }
}
