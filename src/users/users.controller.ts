import { assertSellerSignupOpen } from '../auth/seller-signup';
import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Query,
  Req,
  UseGuards,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateProfileDto } from './dto/create-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GetUsersDto } from './dto/get-users.dto';
import { AddStaffDto } from './dto/add-staff.dto';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, hasRole, SUPER_ADMIN, STORE_OWNER } from '../auth/roles.decorator';
import { omitPassword } from '../common/sanitize';

// Rôles dont la liste est consultable publiquement (sélection d'un point de retrait),
// avec uniquement des colonnes non sensibles.
const PUBLIC_LIST_ROLES = ['super_pickuppoint', 'super_centre'];

function stripPasswords(result: any) {
  if (Array.isArray(result)) return result.map(omitPassword);
  if (result && Array.isArray(result.data)) return { ...result, data: result.data.map(omitPassword) };
  return omitPassword(result);
}

function assertSelfOrAdmin(req: any, id: number) {
  if (!hasRole(req.user, SUPER_ADMIN) && Number(req.user?.id) !== Number(id)) {
    throw new ForbiddenException('Accès refusé.');
  }
}
interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email?: string;
    role?: string;
    userId?:number
  };
}
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }
  // Protection route avec auth JWT (adapter selon ton auth) const userId: number = req.user
  @UseGuards(AuthGuard('jwt'))
  @Post('became-seller')
  async becomeSeller(@Req() req: AuthenticatedRequest) {
    // Fermé tant que SELLER_SIGNUP_OPEN n'est pas activé (décision du 25/09/2026)
    assertSellerSignupOpen();
    const userId: number = req.user.userId;
    console.log("mon user userId", userId)
    if (!userId) throw new UnauthorizedException();

    const result = await this.usersService.updateUserRole(userId);

    return {
      message: 'Félicitations ! Vous êtes désormais reconnu comme vendeur sur notre plateforme halileecommerce.com.',
      token: result.token,
      permissions: result.permissions,
    };
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Post()
  async createUser(@Body() createUserDto: CreateUserDto) {
    return stripPasswords(await this.usersService.create(createUserDto));
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  async getAllUsers(@Query() query: GetUsersDto & { role?: string }, @Req() req: any) {
    if (hasRole(req.user, SUPER_ADMIN)) {
      return stripPasswords(await this.usersService.getUsers(query));
    }
    if (query.role && PUBLIC_LIST_ROLES.includes(query.role)) {
      return this.usersService.getPublicUsersByRole(query);
    }
    throw new ForbiddenException('Accès refusé.');
  }

  // Compteurs des filtres de la liste admin (déclaré avant « :id »)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Get('facets')
  async getUserFacets(@Query('role') role?: string) {
    return this.usersService.getUserFacets(role || undefined);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getUser(@Param('id') id: string, @Req() req: any) {
    assertSelfOrAdmin(req, +id);
    return stripPasswords(await this.usersService.findOne(+id));
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async updateUser(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto, @Req() req: any) {
    assertSelfOrAdmin(req, +id);
    return stripPasswords(await this.usersService.update(+id, updateUserDto));
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  removeUser(@Param('id') id: string, @Req() req: any) {
    assertSelfOrAdmin(req, +id);
    return this.usersService.remove(+id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Post('unblock-user')
  async activeUser(@Body('id') id: number) {
    return stripPasswords(await this.usersService.activeUser(+id));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Post(':id/ban')
  banUser(@Param('id') id: number) {
    console.log(id);
    // return this.usersService.getUsers(updateUserInput.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(SUPER_ADMIN)
  @Post('block-user')
  async blockUser(@Body('id') id: number) {
    return stripPasswords(await this.usersService.banUser(id));
  }

}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly usersService: UsersService) { }

  @Post()
  createProfile(@Body() createProfileDto: CreateProfileDto) {
    console.log(createProfileDto);
  }

  @Put(':id')
  updateProfile(@Body() updateProfileDto: UpdateProfileDto) {
    console.log(updateProfileDto);
  }

  @Delete(':id')
  deleteProfile(@Param('id') id: number) {
    return this.usersService.remove(id);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('admin/list')
export class AdminController {
  constructor(private readonly usersService: UsersService) { }

  @Get()
  async getAllAdmin(@Query() query: GetUsersDto) {
    return stripPasswords(await this.usersService.getAdmin(query));
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('vendors/list')
export class VendorController {
  constructor(private readonly usersService: UsersService) { }

  @Get()
  async getAllVendor(@Query() query: GetUsersDto) {
    return stripPasswords(await this.usersService.getVendors(query));
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN, STORE_OWNER)
@Controller('my-staffs')
export class MyStaffsController {
  constructor(private readonly usersService: UsersService) { }

  @Get()
  async getAllMyStaffs(@Query() query: GetUsersDto) {
    return stripPasswords(await this.usersService.getMyStaffs(query));
  }
}
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('all-staffs')
export class AllStaffsController {
  constructor(private readonly usersService: UsersService) { }

  @Get()
  async getAllStaffs(@Query() query: GetUsersDto) {
    return stripPasswords(await this.usersService.getAllStaffs(query));
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(SUPER_ADMIN)
@Controller('customers/list')
export class AllCustomerController {
  constructor(private readonly usersService: UsersService) { }

  @Get()
  async getAllCustomers(@Query() query: GetUsersDto) {
    return stripPasswords(await this.usersService.getAllCustomers(query));
  }
}
