import { Controller, Get, Delete, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { PlanTierId } from '../users/subscription-store';

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @UseGuards(AdminGuard)
  @Get('users')
  @ApiOperation({ summary: 'Admin: Get list of all registered users' })
  async getUsers() {
    return this.adminService.getAllUsers();
  }

  @UseGuards(AdminGuard)
  @Get('stats')
  @ApiOperation({ summary: 'Admin: Retrieve platform overview statistics and metrics' })
  async getStats() {
    return this.adminService.getStats();
  }

  @UseGuards(AdminGuard)
  @Patch('users/:id/subscription')
  @ApiOperation({ summary: 'Admin: Manually update user subscription plan or AI token balance' })
  async updateUserSubscription(
    @Param('id') id: string,
    @Body() body: { planTier?: PlanTierId; aiTokensBalance?: number; addTokens?: number },
  ) {
    return this.adminService.updateUserSubscription(id, body);
  }

  @UseGuards(AdminGuard)
  @Delete('users/:id')
  @ApiOperation({ summary: 'Admin: Delete or ban a user' })
  async deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }
}
