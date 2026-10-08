import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import mikroOrmConfig from '../mikro-orm.config';
import { SqsModule } from './infrastructure/messaging/sqs';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { ApplicationModule } from './application/application.module';
import { HttpModule } from './interfaces/http/http.module';

@Module({
  imports: [
    MikroOrmModule.forRoot({
      ...mikroOrmConfig,
      autoLoadEntities: true,
    }),
    PersistenceModule,
    ApplicationModule,
    HttpModule,
    SqsModule,
  ],
})
export class AppModule {}
