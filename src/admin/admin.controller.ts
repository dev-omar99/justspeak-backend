import { Controller, Get, Delete, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { PlanTierId } from '../users/subscription-store';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @UseGuards(AdminGuard)
  @Get('users')
  async getUsers() {
    return this.adminService.getAllUsers();
  }

  @UseGuards(AdminGuard)
  @Get('stats')
  async getStats() {
    return this.adminService.getStats();
  }

  @UseGuards(AdminGuard)
  @Patch('users/:id/subscription')
  async updateUserSubscription(
    @Param('id') id: string,
    @Body() body: { planTier?: PlanTierId; aiTokensBalance?: number; addTokens?: number },
  ) {
    return this.adminService.updateUserSubscription(id, body);
  }

  @UseGuards(AdminGuard)
  @Delete('users/:id')
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }
}