import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from '../../../infrastructure/observability/metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  async getMetrics(@Res() response: Response): Promise<void> {
    response.type(this.metrics.contentType).send(await this.metrics.render());
  }
}
