import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import {
  AdminController,
  AllCustomerController,
  AllStaffsController,
  MyStaffsController,
  ProfilesController,
  UsersController,
  VendorController,
} from './users.controller';
import { DatabaseModule } from '../database/database.module'; // ✅ ici
@Module({
  imports: [DatabaseModule], // ✅ ici
  controllers: [
    UsersController,
    ProfilesController,
    AdminController,
    VendorController,
    MyStaffsController,
    AllStaffsController,
    AllCustomerController,
  ],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule { }
