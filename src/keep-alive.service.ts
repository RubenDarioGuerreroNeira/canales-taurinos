import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class KeepAliveService implements OnModuleInit {
  private readonly logger = new Logger(KeepAliveService.name);
  private readonly url = 'https://canales-taurinos.onrender.com/ping'; // tu dominio
  private readonly intervalMs = 10 * 60 * 1000; // cada 10 min

  onModuleInit() {
    this.logger.log('Servicio KeepAlive iniciado 🚀');
    setInterval(async () => {
      try {
        const res = await axios.get(this.url);
        this.logger.log(`Ping exitoso: ${res.data.message}`);
      } catch (error) {
        this.logger.error(`Error al hacer ping: ${error.message}`);
      }
    }, this.intervalMs);
  }
}
