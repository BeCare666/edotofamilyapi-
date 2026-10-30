import { InactivityCron, InactivityService } from './inactivity';
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import {
  AdminController,
  AllCustomerController,
  AllStaffsController,
  MyStaffsController,
  UsersController,
  VendorController,
} from './users.controller';
import { ProfilePhotoController } from './profile-photo.controller';
import { MyDataController, MyDataService } from './my-data';
import { DatabaseModule } from '../database/database.module'; // ✅ ici
@Module({
  imports: [DatabaseModule], // ✅ ici
  controllers: [
    UsersController,
    AdminController,
    VendorController,
    MyStaffsController,
    AllStaffsController,
    AllCustomerController,
    ProfilePhotoController,
    MyDataController,
  ],
  providers: [UsersService, InactivityService, InactivityCron, MyDataService],
  exports: [UsersService],
})
export class UsersModule { }
