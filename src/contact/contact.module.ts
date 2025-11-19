import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ContactService } from './contact.service';

@Module({
  imports: [ConfigModule],
  providers: [ContactService],
  exports: [ContactService],
})
export class ContactModule { }
